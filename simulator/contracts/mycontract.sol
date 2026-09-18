// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../solidity/ICasinoGameV2.sol";

contract MexicanStandoff is ICasinoGameV2 {

    uint256 private constant WAD = 1e18;
    uint8 private constant PLAYER_COUNT = 10;
    uint8 private constant FIXED_DEATHS = 2; // locked — no variable death count
    uint256 private constant EDGE_NUM = 95; // 5% house edge, /100
    uint256 private constant MAX_MULTIPLIER_WAD = 5_000_000_000_000_000_000; // 5x hard cap

    /*
        Mines-style: player picks p players (1 <= p <= 8) they believe
        survive. Exactly FIXED_DEATHS (2) random players are eliminated.
        Win only if NONE of the picks were eliminated — all or nothing.

        Multiplier is a hand-tuned smooth progression (1.10x -> 5.00x)
        indexed purely by pick count p, since deathCount is now fixed.
    */

    struct GameState {
        uint16 pickMask; // bit i set = player i picked
        uint8 deathCount; // always FIXED_DEATHS, kept for state-layout compatibility
    }

    // =============================================================
    //                          CAPS
    // =============================================================

    function quoteCaps(
        uint256 wager,
        bytes calldata
    )
        external
        pure
        override
        returns (uint256 maxEscrowStake, uint256 maxReservedProfit)
    {
        maxEscrowStake = wager;
        maxReservedProfit = (wager * (MAX_MULTIPLIER_WAD - WAD)) / WAD;
    }

    // =============================================================
    //                       RISK PARAMETERS
    // =============================================================

    function quoteRiskParams(
        uint256 wager,
        bytes calldata
    )
        external
        pure
        override
        returns (
            uint256 maxPayout,
            uint256 probabilityWad,
            uint256 expectedPayout,
            uint256 subJackpotVarianceScaled
        )
    {
        maxPayout = (wager * MAX_MULTIPLIER_WAD) / WAD;
        // Worst-case win probability (p=8, deathCount=2) is C(2,2)/C(10,2) = 1/45 ≈ 2.22%.
        probabilityWad = WAD / 45;
        expectedPayout = (maxPayout * probabilityWad) / WAD;
        subJackpotVarianceScaled = 0;
    }

    // =============================================================
    //                       SESSION START
    // =============================================================

    /*
        gameData: abi.encode(uint16 pickMask, uint8 deathCount)
        deathCount must equal FIXED_DEATHS (2) — kept as an explicit
        field (rather than dropped) so the client encoding and
        GameState layout stay unchanged.
    */
    function onSessionStart(
        SessionContext calldata ctx
    )
        external
        pure
        override
        returns (StepResult memory result)
    {
        require(ctx.wagerBase > 0, "ZERO_WAGER");
        require(ctx.gameData.length == 64, "BAD_GAME_DATA");

        (uint16 pickMask, uint8 deathCount) = abi.decode(ctx.gameData, (uint16, uint8));

        require(deathCount == FIXED_DEATHS, "INVALID_DEATH_COUNT");
        require(pickMask != 0, "NO_PICKS");
        require(pickMask & ~uint16(0x3FF) == 0, "INVALID_PLAYER_BIT"); // only bits 0-9 valid

        uint8 p = _popcount(pickMask);
        uint8 maxPicks = PLAYER_COUNT - FIXED_DEATHS;
        require(p <= maxPicks, "TOO_MANY_PICKS");

        GameState memory state = GameState({ pickMask: pickMask, deathCount: FIXED_DEATHS });

        result.newGameState = abi.encode(state);
        result.escrowDelta = 0;
        result.reservedProfitDelta = 0;
        result.nextPhase = SessionPhase.WAITING_RANDOMNESS;
        result.requestRandomnessNow = true;
        result.payout = 0;
    }

    // =============================================================
    //                       PLAYER ACTION
    // =============================================================

    function onPlayerAction(
        SessionContext calldata,
        bytes calldata
    )
        external
        pure
        override
        returns (StepResult memory)
    {
        revert("NO_PLAYER_ACTIONS");
    }

    // =============================================================
    //                        RANDOMNESS
    // =============================================================

    function onRandomness(
        SessionContext calldata ctx,
        bytes32 randomness
    )
        external
        pure
        override
        returns (StepResult memory result)
    {
        GameState memory state = _decodeState(ctx.gameState);

        uint16 aliveMask = (uint16(1) << PLAYER_COUNT) - 1;
        bool anyPickEliminated = false;

        for (uint8 i = 0; i < FIXED_DEATHS; i++) {
            bytes32 subRandom = keccak256(abi.encodePacked(randomness, i));
            uint8 eliminated = _randomAlivePlayer(aliveMask, uint256(subRandom));

            aliveMask &= ~(uint16(1) << eliminated);

            if ((state.pickMask & (uint16(1) << eliminated)) != 0) {
                anyPickEliminated = true;
            }
        }

        result.newGameState = ctx.gameState; // unchanged — terminal
        result.escrowDelta = 0;
        result.reservedProfitDelta = 0;
        result.nextPhase = SessionPhase.SETTLED;
        result.requestRandomnessNow = false;

        if (anyPickEliminated) {
            result.payout = 0;
            return result;
        }

        uint8 p = _popcount(state.pickMask);
        uint256 multiplierWad = _multiplierWad(p);
        result.payout = (ctx.wagerBase * multiplierWad) / WAD;
    }

    // =============================================================
    //                    MULTIPLIER TABLE (deathCount fixed at 2)
    // =============================================================

    /// @dev Hand-tuned smooth progression (1.10x -> 5.00x) across the
    ///      8 valid pick counts (1..8) now that deathCount is fixed at 2.
    function _multiplierWad(uint8 p) internal pure returns (uint256) {
        if (p == 1) return 1_100_000_000_000_000_000; // 1.10x
        if (p == 2) return 1_250_000_000_000_000_000; // 1.25x
        if (p == 3) return 1_450_000_000_000_000_000; // 1.45x
        if (p == 4) return 1_700_000_000_000_000_000; // 1.70x
        if (p == 5) return 2_050_000_000_000_000_000; // 2.05x
        if (p == 6) return 2_550_000_000_000_000_000; // 2.55x
        if (p == 7) return 3_350_000_000_000_000_000; // 3.35x
        if (p == 8) return 5_000_000_000_000_000_000; // 5.00x
        revert("INVALID_PICK_COUNT");
    }

    // =============================================================
    //                    FORFEIT / ABANDON
    // =============================================================

    function quoteForfeitPayout(
        SessionContext calldata
    )
        external
        pure
        override
        returns (uint256)
    {
        return 0; // one-shot bet — nothing resolved until randomness returns
    }

    // =============================================================
    //                         HELPERS
    // =============================================================

    function _decodeState(bytes memory encoded) internal pure returns (GameState memory) {
        require(encoded.length > 0, "EMPTY_STATE");
        return abi.decode(encoded, (GameState));
    }

    function _isAlive(uint16 mask, uint8 player) internal pure returns (bool) {
        return (mask & (uint16(1) << player)) != 0;
    }

    function _popcount(uint16 mask) internal pure returns (uint8 count) {
        for (uint8 i = 0; i < PLAYER_COUNT; i++) {
            if (mask & (uint16(1) << i) != 0) count++;
        }
    }

    function _randomAlivePlayer(uint16 mask, uint256 random) internal pure returns (uint8) {
        uint8 aliveCount = 0;
        for (uint8 i = 0; i < PLAYER_COUNT; i++) {
            if (_isAlive(mask, i)) aliveCount++;
        }
        require(aliveCount > 0, "NO_SURVIVORS");

        uint256 target = random % aliveCount;
        uint8 seen = 0;
        for (uint8 i = 0; i < PLAYER_COUNT; i++) {
            if (_isAlive(mask, i)) {
                if (seen == target) return i;
                seen++;
            }
        }
        revert("RANDOM_SELECTION_FAILED");
    }
}
