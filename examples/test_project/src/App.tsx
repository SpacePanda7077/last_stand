import { useCallback, useEffect, useRef, useState } from "react";
import type { HexString } from "@chain/casino-sdk";
import "./App.css";
import { useCasinoHost } from "./lib/useCasinoHost";
import { decodeAbiParameters, encodeAbiParameters } from "viem";

export const EMPTY_HEX = "0x" as HexString;

// ---- gameData: what's sent when opening the session ----
export type PickBet = {
  firstPick: number; // 1..5
};

const GAME_DATA_PARAMS = [{ type: "uint8" }] as const;

export function encodeGameData(bet: PickBet): HexString {
  return encodeAbiParameters(GAME_DATA_PARAMS, [bet.firstPick]);
}

export function decodeGameData(gameData: HexString): PickBet | null {
  try {
    const [firstPick] = decodeAbiParameters(GAME_DATA_PARAMS, gameData);
    return { firstPick };
  } catch {
    return null;
  }
}

// ---- gameState: what the contract returns after each step ----
const GAME_STATE_PARAMS = [
  { type: "uint8" }, // roundSize — size of the round just resolved
  { type: "uint8" }, // playerPick
  { type: "uint8" }, // contractPick — 0 until randomness has resolved
  { type: "bool" }, // matched — true if playerPick === contractPick (loss)
  { type: "bool" }, // won — true only once settled with a win
  { type: "uint256" }, // multiplierWad — 1e18 = 1x
] as const;

export type PickGameState = {
  roundSize: number;
  playerPick: number;
  contractPick: number;
  matched: boolean;
  won: boolean;
  multiplierWad: bigint;
};

export function decodeGameState(gameState: HexString): PickGameState | null {
  try {
    const [roundSize, playerPick, contractPick, matched, won, multiplierWad] =
      decodeAbiParameters(GAME_STATE_PARAMS, gameState);
    return { roundSize, playerPick, contractPick, matched, won, multiplierWad };
  } catch {
    return null;
  }
}

// ---- actionData: cash out or continue with a new pick ----
const ACTION_DATA_PARAMS = [
  { type: "bool" }, // cashOut
  { type: "uint8" }, // nextPick — ignored by the contract if cashOut is true
] as const;

export function encodeActionData(
  cashOut: boolean,
  nextPick: number,
): HexString {
  return encodeAbiParameters(ACTION_DATA_PARAMS, [cashOut, nextPick]);
}

function App() {
  const { hostApi, snapshot } = useCasinoHost();
  const hostApiRef = useRef(hostApi);
  hostApiRef.current = hostApi;

  const [currentSessionKey, setCurrentSessionKey] = useState<string | null>(
    null,
  );

  const [state, setState] = useState<PickGameState | null>(null);
  const [firstPickInput, setFirstPickInput] = useState<number>(1);
  const [nextPickInput, setNextPickInput] = useState<number>(1);

  const openRound = useCallback(
    async (bet: PickBet, wager: bigint) => {
      if (!hostApi) return;
      try {
        const { sessionKey } = await hostApi.openSession({
          wager: wager.toString(),
          gameData: encodeGameData(bet),
          randomnessRequestData: EMPTY_HEX,
        });
        setCurrentSessionKey(sessionKey);
        setState(null);
      } catch (cause) {
        console.log(cause);
      }
    },
    [hostApi],
  );

  // ⚠️ `submitAction` is a placeholder — confirm the real method name on hostApi.
  const sendAction = useCallback(
    async (cashOut: boolean, nextPick: number) => {
      if (!hostApiRef.current || !currentSessionKey) return;
      const [, sessionIdPart] = currentSessionKey.split(":");

      try {
        await hostApiRef.current.submitAction({
          sessionId: sessionIdPart,
          actionData: encodeActionData(cashOut, nextPick),
        });
      } catch (cause) {
        console.log(cause);
      }
    },
    [currentSessionKey],
  );

  useEffect(() => {
    if (!snapshot || !currentSessionKey) return;
    const row = snapshot.sessions.items.find(
      (item) => item.sessionKey === currentSessionKey,
    );
    console.log("row : ", row);
    if (!row || !row.raw?.gameState) return;

    const decoded = decodeGameState(row.raw.gameState);
    setState(decoded);

    if (decoded) {
      // Reset the next-pick input to a valid value for the upcoming round.
      setNextPickInput(1);
    }

    const won = row.payout !== undefined && BigInt(row.payout) > 0n;
    console.log("decoded state:", decoded);
    console.log("won (from payout):", won);
  }, [snapshot, currentSessionKey]);

  if (!hostApi) {
    return (
      <div className="ck-canvas-loading">
        <div className="ck-canvas-loading__card">
          <div className="ck-canvas-loading__spinner" aria-hidden />
          <span className="ck-canvas-loading__label">Connecting to host…</span>
        </div>
      </div>
    );
  }

  const roundOver = currentSessionKey === null || state?.matched || state?.won;
  const canAct =
    state !== null && !state.matched && !state.won && state.roundSize >= 3;
  const nextRoundSize = state ? state.roundSize - 1 : 0;

  return (
    <div>
      {roundOver ? (
        <div>
          {state?.matched && (
            <p>You lost — contract picked {state.contractPick}.</p>
          )}
          {state?.won && (
            <p>You won at {Number(state.multiplierWad) / 1e18}x!</p>
          )}
          <label>
            Pick a number (1–5):
            <input
              type="number"
              min={1}
              max={5}
              value={firstPickInput}
              onChange={(e) => {
                const val = Number(e.target.value);
                setFirstPickInput(Number.isNaN(val) ? 0 : val);
              }}
            />
          </label>
          <button
            onClick={() => {
              console.log("submitting firstPick:", firstPickInput); // confirm before it hits the chain
              openRound({ firstPick: firstPickInput }, BigInt("1"));
            }}
          >
            Bet
          </button>
        </div>
      ) : canAct ? (
        <div>
          <p>
            Survived round of {state!.roundSize}. Current multiplier:{" "}
            {Number(state!.multiplierWad) / 1e18}x
          </p>
          <label>
            Pick a number (1–{nextRoundSize}):
            <input
              type="number"
              min={1}
              max={nextRoundSize}
              value={nextPickInput}
              onChange={(e) => setNextPickInput(Number(e.target.value))}
            />
          </label>
          <button onClick={() => sendAction(false, nextPickInput)}>
            Continue
          </button>
          <button onClick={() => sendAction(true, 0)}>Cash out</button>
        </div>
      ) : (
        <p>Waiting for result…</p>
      )}
    </div>
  );
}

export default App;
