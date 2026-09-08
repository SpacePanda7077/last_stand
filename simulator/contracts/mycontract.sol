// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../solidity/ICasinoGameV2.sol";

contract MexicanStandoff is ICasinoGameV2 {

    uint256 private constant WAD = 1e18;
    uint8 private constant PLAYER_COUNT = 10;
    uint8 private constant MIN_DEATHS = 3;
    uint8 private constant MAX_DEATHS = 8;
    uint256 private constant EDGE_NUM = 95; // 5% house edge, /100
    uint256 private constant MAX_MULTIPLIER_WAD = 5_000_000_000_000_000_000; // 5x hard cap

    /*
        Mines-style: player picks p players (1 <= p <= 10 - deathCount)
        they believe survive. deathCount random players are eliminated.
        Win only if NONE of the picks were eliminated — all or nothing.

        Multipliers are hand-tuned smooth geometric-style progressions
        (start ~1.10x, climb to 5.00x hard cap) for every supported
        deathCount (3..8), replacing the raw combinatorial formula,
        which spikes to the 5x cap after only 2-3 picks and produces
        a flat, unsatisfying curve for k >= 4.
    */

    struct GameState {
        uint16 pickMask; // bit i set = player i picked
        uint8 deathCount;
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
        // Worst-case win probability among capped combos is k=5,p=5 at 0.40%.
        probabilityWad = WAD / 250;
        expectedPayout = (maxPayout * probabilityWad) / WAD;
        subJackpotVarianceScaled = 0;
    }

    // =============================================================
    //                       SESSION START
    // =============================================================

    /*
        gameData: abi.encode(uint16 pickMask, uint8 deathCount)
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

        require(deathCount >= MIN_DEATHS && deathCount <= MAX_DEATHS, "INVALID_DEATH_COUNT");
        require(pickMask != 0, "NO_PICKS");
        require(pickMask & ~uint16(0x3FF) == 0, "INVALID_PLAYER_BIT"); // only bits 0-9 valid

        uint8 p = _popcount(pickMask);
        uint8 maxPicks = PLAYER_COUNT - deathCount;
        require(p <= maxPicks, "TOO_MANY_PICKS");

        GameState memory state = GameState({ pickMask: pickMask, deathCount: deathCount });

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

        for (uint8 i = 0; i < state.deathCount; i++) {
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
        uint256 multiplierWad = _multiplierWad(state.deathCount, p);
        result.payout = (ctx.wagerBase * multiplierWad) / WAD;
    }

    // =============================================================
    //                    MULTIPLIER / COMBINATORICS
    // =============================================================

    /// @dev Hand-tuned smooth progressions (1.10x -> 5.00x) for every
    ///      supported deathCount. Replaces the raw combinatorial formula,
    ///      which was only smooth-looking by coincidence for k=3 and
    ///      degenerates into a flat run of 5.00x caps for k >= 4.
   function _multiplierWad(uint8 k, uint8 p) internal pure returns (uint256) {
    if (k == 3) {
        if (p == 1) return 1_200_000_000_000_000_000; // 1.20x
        if (p == 2) return 1_450_000_000_000_000_000; // 1.45x
        if (p == 3) return 1_850_000_000_000_000_000; // 1.85x
        if (p == 4) return 2_400_000_000_000_000_000; // 2.40x
        if (p == 5) return 3_150_000_000_000_000_000; // 3.15x
        if (p == 6) return 4_100_000_000_000_000_000; // 4.10x
        if (p == 7) return 5_000_000_000_000_000_000; // 5.00x
        revert("INVALID_P_FOR_K3");
    }

    if (k == 4) {
        if (p == 1) return 1_350_000_000_000_000_000; // 1.35x
        if (p == 2) return 1_700_000_000_000_000_000; // 1.70x
        if (p == 3) return 2_200_000_000_000_000_000; // 2.20x
        if (p == 4) return 2_900_000_000_000_000_000; // 2.90x
        if (p == 5) return 3_850_000_000_000_000_000; // 3.85x
        if (p == 6) return 5_000_000_000_000_000_000; // 5.00x
        revert("INVALID_P_FOR_K4");
    }

    if (k == 5) {
        if (p == 1) return 1_550_000_000_000_000_000; // 1.55x
        if (p == 2) return 2_050_000_000_000_000_000; // 2.05x
        if (p == 3) return 2_800_000_000_000_000_000; // 2.80x
        if (p == 4) return 3_900_000_000_000_000_000; // 3.90x
        if (p == 5) return 5_000_000_000_000_000_000; // 5.00x
        revert("INVALID_P_FOR_K5");
    }

    if (k == 6) {
        if (p == 1) return 1_850_000_000_000_000_000; // 1.85x
        if (p == 2) return 2_600_000_000_000_000_000; // 2.60x
        if (p == 3) return 3_750_000_000_000_000_000; // 3.75x
        if (p == 4) return 5_000_000_000_000_000_000; // 5.00x
        revert("INVALID_P_FOR_K6");
    }

    if (k == 7) {
        if (p == 1) return 2_300_000_000_000_000_000; // 2.30x
        if (p == 2) return 3_500_000_000_000_000_000; // 3.50x
        if (p == 3) return 5_000_000_000_000_000_000; // 5.00x
        revert("INVALID_P_FOR_K7");
    }

    if (k == 8) {
        if (p == 1) return 3_000_000_000_000_000_000; // 3.00x
        if (p == 2) return 5_000_000_000_000_000_000; // 5.00x
        revert("INVALID_P_FOR_K8");
    }

    // Defensive fallback (should be unreachable)
    uint256 numerator = EDGE_NUM * WAD * _nCr(PLAYER_COUNT, k);
    uint256 denominator = 100 * _nCr(PLAYER_COUNT - p, k);
    uint256 fair = numerator / denominator;
    return fair > MAX_MULTIPLIER_WAD ? MAX_MULTIPLIER_WAD : fair;
}

    /// @dev n <= 10 always in this contract, so no overflow risk (max C(10,5)=252).
    function _nCr(uint8 n, uint8 r) internal pure returns (uint256) {
        if (r > n) return 0;
        if (r == 0 || r == n) return 1;
        uint256 result = 1;
        for (uint8 i = 0; i < r; i++) {
            result = (result * (n - i)) / (i + 1);
        }
        return result;
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
