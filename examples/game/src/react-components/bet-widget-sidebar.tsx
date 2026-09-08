import { useCallback, useEffect, useRef, useState } from "react";
import { useCasinoHost } from "../lib/useCasinoHost";
import type { HexString } from "@chain/casino-sdk";
import {
    decodeAbiParameters,
    encodeAbiParameters,
    encodePacked,
    keccak256,
} from "viem";
import { EventBus } from "../game/EventBus";
import { useBalance } from "../store/Balance";

const PLAYER_COUNT = 10;
const MIN_DEATHS = 3;
const MAX_DEATHS = 8;
const EDGE_NUM = 95n;
const WAD = 1_000_000_000_000_000_000n;
const MAX_MULTIPLIER_WAD = 5_000_000_000_000_000_000n;

function maxPicksFor(deathCount: number): number {
    return PLAYER_COUNT - deathCount;
}

function nCr(n: number, r: number): bigint {
    if (r > n) return 0n;
    if (r === 0 || r === n) return 1n;
    let result = 1n;
    for (let i = 0; i < r; i++) {
        result = (result * BigInt(n - i)) / BigInt(i + 1);
    }
    return result;
}

// Hand-tuned smooth progressions (1.10x -> 5.00x), mirroring
// MexicanStandoff.sol::_multiplierWad exactly. Index 0 = picks 1.
// Replaces the raw combinatorial formula, which was only smooth-looking
// by coincidence for deathCount 3 and flattens out to repeated 5.00x
// caps for deathCount >= 4.
const SMOOTH_MULTIPLIERS_WAD: Record<number, readonly bigint[]> = {
    3: [
        1_200_000_000_000_000_000n, // 1.20x
        1_450_000_000_000_000_000n, // 1.45x
        1_850_000_000_000_000_000n, // 1.85x
        2_400_000_000_000_000_000n, // 2.40x
        3_150_000_000_000_000_000n, // 3.15x
        4_100_000_000_000_000_000n, // 4.10x
        5_000_000_000_000_000_000n, // 5.00x
    ],
    4: [
        1_350_000_000_000_000_000n, // 1.35x
        1_700_000_000_000_000_000n, // 1.70x
        2_200_000_000_000_000_000n, // 2.20x
        2_900_000_000_000_000_000n, // 2.90x
        3_850_000_000_000_000_000n, // 3.85x
        5_000_000_000_000_000_000n, // 5.00x
    ],
    5: [
        1_550_000_000_000_000_000n, // 1.55x
        2_050_000_000_000_000_000n, // 2.05x
        2_800_000_000_000_000_000n, // 2.80x
        3_900_000_000_000_000_000n, // 3.90x
        5_000_000_000_000_000_000n, // 5.00x
    ],
    6: [
        1_850_000_000_000_000_000n, // 1.85x
        2_600_000_000_000_000_000n, // 2.60x
        3_750_000_000_000_000_000n, // 3.75x
        5_000_000_000_000_000_000n, // 5.00x
    ],
    7: [
        2_300_000_000_000_000_000n, // 2.30x
        3_500_000_000_000_000_000n, // 3.50x
        5_000_000_000_000_000_000n, // 5.00x
    ],
    8: [
        3_000_000_000_000_000_000n, // 3.00x
        5_000_000_000_000_000_000n, // 5.00x
    ],
};

function multiplierWad(deathCount: number, picks: number): bigint {
    if (picks === 0) return 0n;

    const table = SMOOTH_MULTIPLIERS_WAD[deathCount];
    if (table) {
        return table[picks - 1] ?? MAX_MULTIPLIER_WAD;
    }

    // Unreachable given MIN_DEATHS/MAX_DEATHS bounds (3..8), kept only
    // as a defensive fallback using the original combinatorial formula.
    const remaining = PLAYER_COUNT - picks;
    if (remaining < deathCount) {
        return MAX_MULTIPLIER_WAD;
    }

    const numerator = EDGE_NUM * WAD * nCr(PLAYER_COUNT, deathCount);
    const denominator = 100n * nCr(remaining, deathCount);

    if (denominator === 0n) return MAX_MULTIPLIER_WAD;

    const fair = numerator / denominator;
    return fair > MAX_MULTIPLIER_WAD ? MAX_MULTIPLIER_WAD : fair;
}

function multiplierDisplay(deathCount: number, picks: number): number {
    return Number(multiplierWad(deathCount, picks)) / 1e18;
}

export type MexicanStandoffState = {
    pickMask: number;
    deathCount: number;
};

const GAME_STATE_PARAMS = [{ type: "uint16" }, { type: "uint8" }] as const;

export function decodeGameState(
    gameState: HexString,
): MexicanStandoffState | null {
    try {
        const [pickMask, deathCount] = decodeAbiParameters(
            GAME_STATE_PARAMS,
            gameState,
        );
        return { pickMask, deathCount };
    } catch {
        return null;
    }
}

const GAME_DATA_PARAMS = [{ type: "uint16" }, { type: "uint8" }] as const;

export function encodePicksAndDeathCount(
    pickedIndices: number[],
    deathCount: number,
): HexString {
    const mask = pickedIndices.reduce((acc, i) => acc | (1 << i), 0);
    return encodeAbiParameters(GAME_DATA_PARAMS, [mask, deathCount]);
}

export const EMPTY_HEX = "0x" as HexString;

function computeEliminatedPlayers(
    randomness: HexString,
    deathCount: number,
): number[] {
    let aliveMask = (1 << PLAYER_COUNT) - 1;
    const eliminated: number[] = [];

    for (let i = 0; i < deathCount; i++) {
        const subRandom = keccak256(
            encodePacked(
                ["bytes32", "uint8"],
                [randomness as `0x${string}`, i],
            ),
        );
        const randomBig = BigInt(subRandom);

        let aliveCount = 0;
        for (let p = 0; p < PLAYER_COUNT; p++) {
            if (aliveMask & (1 << p)) aliveCount++;
        }

        const target = randomBig % BigInt(aliveCount);
        let seen = 0n;
        for (let p = 0; p < PLAYER_COUNT; p++) {
            if (aliveMask & (1 << p)) {
                if (seen === target) {
                    eliminated.push(p);
                    aliveMask &= ~(1 << p);
                    break;
                }
                seen++;
            }
        }
    }
    return eliminated;
}

type SessionRow = {
    sessionKey: string;
    sessionId: string;
    phase: number;
    phaseName: string;
    isSettled: boolean;
    payout?: string;
    wager: string;
    stake: string;
    raw: { gameState: HexString; randomness?: HexString; [k: string]: any };
};

export default function BetWidgetSidebar() {
    const { hostApi, snapshot } = useCasinoHost();
    const hostApiRef = useRef(hostApi);
    hostApiRef.current = hostApi;
    const balance = useBalance((s) => s.balance);
    const setBalance = useBalance((s) => s.setBalance);
    const [currentSessionKey, setCurrentSessionKey] = useState<string | null>(
        null,
    );
    const [row, setRow] = useState<SessionRow | null>(null);
    const [state, setState] = useState<MexicanStandoffState | null>(null);
    const [picks, setPicks] = useState<number[]>([]);
    const [eliminated, setEliminated] = useState<number[]>([]);
    const [suvivor_empty, setSuvivorEmpty] = useState(false);
    const [amount_empty, setAmountEmpty] = useState(false);
    const [deathCount, setDeathCount] = useState(MIN_DEATHS);
    const [wager, setWager] = useState<BigInt>(1n);

    const lastEmittedGameState = useRef<string | null>(null);
    const openInFlight = useRef(false);
    const decisionEmittedFor = useRef<string | null>(null);

    const maxPicks = maxPicksFor(deathCount);

    // Force-deselect excess picks when deathCount rises
    useEffect(() => {
        setPicks((current) => {
            if (current.length <= maxPicks) return current;

            // Keep the lowest player numbers (most stable)
            const sorted = [...current].sort((a, b) => a - b);
            return sorted.slice(0, maxPicks);
        });
    }, [maxPicks]);

    const togglePick = useCallback(
        (i: number) => {
            setPicks((current) => {
                // Deselect
                if (current.includes(i)) {
                    return current.filter((p) => p !== i);
                }

                // Only hard limit
                if (current.length >= maxPicks) return current;

                return [...current, i];
            });
        },
        [maxPicks],
    );
    useEffect(() => {
        console.log(picks);
        EventBus.emit("survivor_choosen", picks);
    }, [picks]);

    //=============================================================//
    //  =============Test Open Round =============================//
    //============================================================//

    function getRandomPicks(deathCount: number) {
        const numbers: number[] = [];

        while (numbers.length < deathCount) {
            const randomNum = Math.floor(Math.random() * 10);
            if (!numbers.includes(randomNum)) {
                numbers.push(randomNum);
            }
        }

        return numbers;
    }

    const openTestRound = useCallback(async () => {
        if (picks.length < 1) {
            setSuvivorEmpty(true);
            setTimeout(() => {
                setSuvivorEmpty(false);
            }, 3000);
            EventBus.emit("show_notification", "Choose A Survivor");
            return;
        }
        if (Number(wager) < 1) {
            setAmountEmpty(true);
            setTimeout(() => {
                setAmountEmpty(false);
            }, 3000);
            EventBus.emit("show_notification", "Invalid Amount");
            return;
        }

        const rand_picks = getRandomPicks(deathCount);
        setEliminated(rand_picks);
        setCurrentSessionKey("uutygyyfy");
        const newBalance = balance - Number(wager);
        setBalance(newBalance);
        console.log(rand_picks);
    }, [picks, deathCount, wager]);

    const openRound = useCallback(async () => {
        if (!hostApi || openInFlight.current) {
            openTestRound();
            return;
        }
        if (picks.length < 1) {
            setSuvivorEmpty(true);
            setTimeout(() => {
                setSuvivorEmpty(false);
            }, 3000);
            EventBus.emit("show_notification", "Choose A Survivor");
            return;
        }
        if (Number(wager) < 1) {
            setAmountEmpty(true);
            setTimeout(() => {
                setAmountEmpty(false);
            }, 3000);
            EventBus.emit("show_notification", "Invalid Amount");
            return;
        }
        openInFlight.current = true;
        try {
            const { sessionKey } = await hostApi.openSession({
                wager: wager.toString(),
                gameData: encodePicksAndDeathCount(picks, deathCount),
                randomnessRequestData: EMPTY_HEX,
            });
            setCurrentSessionKey(sessionKey);
            setRow(null);
            setState(null);
            lastEmittedGameState.current = null;
        } catch (cause) {
            console.log(cause);
        } finally {
            openInFlight.current = false;
        }
    }, [hostApi, picks, deathCount, wager]);

    const resetForNewBet = useCallback(() => {
        setCurrentSessionKey(null);
        setRow(null);
        setState(null);
        setPicks([]);
        setDeathCount(MIN_DEATHS);
        lastEmittedGameState.current = null;
    }, []);

    useEffect(() => {
        if (!snapshot || !currentSessionKey) return;
        const found = snapshot.sessions.items.find(
            (item: any) => item.sessionKey === currentSessionKey,
        ) as SessionRow | undefined;
        if (!found) return;

        setRow(found);

        if (
            !found.raw?.gameState ||
            found.raw.gameState === lastEmittedGameState.current
        )
            return;
        lastEmittedGameState.current = found.raw.gameState;

        const decoded = decodeGameState(found.raw.gameState);
        setState(decoded);
    }, [snapshot, currentSessionKey]);

    useEffect(() => {
        if (!row?.isSettled || !state || !currentSessionKey) return;
        if (decisionEmittedFor.current === currentSessionKey) return;
        decisionEmittedFor.current = currentSessionKey;

        const eliminatedPlayers = row.raw?.randomness
            ? computeEliminatedPlayers(row.raw.randomness, state.deathCount)
            : [];
        const won = row.payout !== undefined && row.payout !== "0";

        EventBus.emit("decision", {
            pickMask: state.pickMask,
            picks,
            currentMultiplier,
            eliminatedPlayers,
            won,
            payout: row.payout,
        });
    }, [row, state, currentSessionKey]);
    const hasNoOverlap = (arr1: number[], arr2: number[]) => {
        // Returns false if any number in arr1 is found in arr2, otherwise returns true
        return !arr1.some((num) => arr2.includes(num));
    };

    //===========================================================================================//
    //===================================Test Confirm ===========================================//
    //===========================================================================================//

    useEffect(() => {
        if (eliminated.length > 0) {
            const won = hasNoOverlap(picks, eliminated);
            EventBus.emit("decision", {
                picks,
                currentMultiplier,
                eliminatedPlayers: eliminated,
                won,
            });
        }
    }, [eliminated]);

    // =============Handle settled ===============//
    const reslove_balance = useCallback(
        (multiplier: number) => {
            const bal = useBalance.getState().balance;
            const balance_to_add = Number(wager) * multiplier;
            const new_balance = bal + balance_to_add;
            console.log(wager, new_balance);
            setBalance(new_balance);
        },
        [wager],
    );
    useEffect(() => {
        EventBus.on("settled", (multiplier: number) => {
            reslove_balance(multiplier);
            setRow({
                sessionKey: "",
                sessionId: "",
                phase: 0,
                phaseName: "",
                isSettled: true,
                payout: "1",
                wager: wager.toString(),
                stake: "",
                raw: { gameState: `0x`, randomness: "0x" },
            });
        });
        return () => {
            EventBus.off("settled");
        };
    }, [wager]);

    const history = [
        { wager: 2, status: "won" },
        { wager: 2, status: "won" },
        { wager: 2, status: "won" },
    ];

    const suggeested_amount = [1n, 5n, 10n, 20n, 50n];

    // if (!hostApi) {
    //     return (
    //         <div className="ck-canvas-loading">
    //             <div className="ck-canvas-loading__card">
    //                 <div className="ck-canvas-loading__spinner" aria-hidden />
    //                 <span className="ck-canvas-loading__label">
    //                     Connecting to host…
    //                 </span>
    //             </div>
    //         </div>
    //     );
    // }

    const roundNotStarted = currentSessionKey === null;
    const settled = row?.isSettled === true;
    const won = settled && row?.payout !== undefined && row.payout !== "0";
    const awaitingRandomness =
        row?.phaseName === "WAITING_RANDOMNESS" && !settled;
    const currentMultiplier = multiplierDisplay(deathCount, picks.length);

    return (
        <>
            <div className="border border-white w-[95%] lg:w-[30%] h-[48%] lg:h-full p-4 rounded-lg bg-[#071623] flex flex-col gap-2 z-1000">
                {roundNotStarted || settled ? (
                    <>
                        {settled && (
                            <p
                                className={
                                    won
                                        ? "text-green-400 text-sm"
                                        : "text-red-400 text-sm"
                                }
                            ></p>
                        )}

                        {!settled && (
                            <>
                                <p className="text-xs opacity-100 font-bold">
                                    Pick up to {maxPicks} players (
                                    {picks.length}/{maxPicks})
                                </p>

                                <div
                                    className={`grid grid-cols-5 gap-2 bg-[#336DBE] px-2 py-1 rounded-lg transition-shadow duration-300 ${
                                        suvivor_empty
                                            ? "shadow-[0_0_20px_5px_rgba(250,52,52,1)] animate-[pulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite]"
                                            : ""
                                    }`}
                                >
                                    {Array.from(
                                        { length: PLAYER_COUNT },
                                        (_, i) => i,
                                    ).map((i) => (
                                        <button
                                            key={i}
                                            onClick={() => togglePick(i)}
                                            className={`w-full rounded-md p-1 ${
                                                picks.includes(i)
                                                    ? "bg-gradient-to-b from-[#FDC94B] to-[#F9B92D] font-bold"
                                                    : "bg-gradient-to-b from-[#113A74] to-[#0A2C58] font-bold"
                                            }`}
                                        >
                                            {i + 1}
                                        </button>
                                    ))}
                                </div>

                                <div className="w-full hidden lg:flex items-end justify-between gap-2 p-2">
                                    {suggeested_amount.map((amount) => (
                                        <button
                                            onClick={() => setWager(amount)}
                                            className={`w-full py-2  rounded-md ${amount === wager ? "bg-gradient-to-b from-[#4BD97A] to-[#2DA84E] " : "bg-gradient-to-b from-[#FDC94B] to-[#F9B92D] border-b-4 border-b-[#B88A27]"} `}
                                        >
                                            $ {amount}
                                        </button>
                                    ))}
                                </div>

                                <input
                                    type="number"
                                    value={Number(wager)}
                                    onChange={(e) => {
                                        setWager(BigInt(e.target.value));
                                    }}
                                    className={`w-full border  rounded-lg p-2 bg-[#030b11] text-[#FDC94B] 
                                       ${
                                           amount_empty
                                               ? "shadow-[0_0_20px_5px_rgba(250,52,52,1)] animate-[pulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] border-[0xff0000]"
                                               : " border-[#FDC94B]"
                                       }`}
                                />

                                <p className="text-xs opacity-60">
                                    Deaths: {deathCount}
                                </p>
                                {/* <input
                                    type="range"
                                    min={MIN_DEATHS}
                                    max={MAX_DEATHS}
                                    step={1}
                                    value={deathCount}
                                    onChange={(e) =>
                                        setDeathCount(Number(e.target.value))
                                    }
                                    className="w-full"
                                /> */}

                                <p className="text-sm">
                                    {picks.length > 0
                                        ? `Multiplier: ${currentMultiplier.toFixed(2)}x`
                                        : "Pick at least 1 player"}
                                </p>
                            </>
                        )}

                        {settled ? (
                            <button
                                onClick={() => {
                                    resetForNewBet();
                                    EventBus.emit("play_again");
                                }}
                                className="w-full py-2 border border-white rounded-md bg-gradient-to-b from-[#4BD97A] to-[#2DA84E] shadow-[0_4px_0_#2DA84E,0_0_20px_rgba(0,255,120,0.4)]"
                            >
                                PLAY AGAIN
                            </button>
                        ) : (
                            <button
                                onClick={() => openRound()}
                                className="w-full py-2 border border-white rounded-md bg-gradient-to-b from-[#FDC94B] to-[#F9B92D] shadow-[0_4px_0_#F9B92D,0_0_20px_rgba(0,120,255,0.6)]"
                            >
                                BET
                            </button>
                        )}
                    </>
                ) : (
                    <p className="text-sm opacity-70">
                        {awaitingRandomness
                            ? "Waiting for result…"
                            : "Loading…"}
                    </p>
                )}

                <div className="w-full hidden md:flex flex-col gap-2 bg-black/50 p-2 rounded-lg min-h-[180px] border border-[#FDC94B]">
                    {history.map((h, i) => (
                        <div
                            key={i}
                            className="flex justify-between items-center"
                        >
                            <p>{h.wager}</p>
                            <p>{h.status}</p>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}

