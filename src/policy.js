'use strict';

/**
 * Angel Wings v2 — Deterministic Integer-Cent Regime-Adaptive Profit Shield
 * ==========================================================================
 * Pure policy engine (zero network calls, zero side effects, integer-cent exact).
 *
 * Hardened per Grok 4.7 Build Audit (2026-11-24):
 *   - All inputs converted ONCE to integer cents (`Math.round(px * 100)`) so
 *     tier boundaries, pullbacks, floors, and log strings match 100% exactly.
 *   - Explicit global gates:
 *       1. Trigger quote must be >= entry + 4c (downside profit-trigger invariant)
 *       2. High-altitude step-ratchets (70c / 84c) require peak >= entry + 12c
 */

function toCents(px) {
  if (!Number.isFinite(px) || px <= 0 || px >= 1) return null;
  const c = Math.round(px * 100);
  return c >= 1 && c <= 99 ? c : null;
}

function evaluateAngelWingsExit({
  avgCost,
  peakBid,
  curBid,
  timeLeftSec = 300,
  regime = 'NORMAL', // 'THETA_PIN' | 'BREAKOUT' | 'NORMAL'
  flowAligned = null // true | false | null
}) {
  const entryC = toCents(avgCost);
  const peakC = toCents(peakBid);
  const bidC = toCents(curBid);
  if (entryC === null || peakC === null || bidC === null) return null;
  if (peakC < bidC) return null; // guard against caller passing stale peak < bid

  // Global Gate 1: Trigger quote must be >= entry + 4c (never triggers on a losing bid)
  if (bidC < entryC + 4) return null;

  const dropC = peakC - bidC;
  const isPinStall = regime === 'THETA_PIN' && flowAligned === false;
  const isBreakoutSurge = regime === 'BREAKOUT' && flowAligned === true;

  // Step-Ratchet High-Altitude Locks (Global Gate 2: peak >= entry + 12c)
  if (peakC >= 84 && peakC >= entryC + 12) {
    const trailC = isBreakoutSurge ? 7 : 5;
    if (dropC >= trailC || bidC <= 78) {
      return {
        action: 'EXIT_PROFIT_LOCK',
        tier: 'STEP_RATCHET_78C',
        reason: `ANGEL WINGS 78c STEP-RATCHET (entry ${entryC}c -> peak ${peakC}c -> bid ${bidC}c)`
      };
    }
  } else if (peakC >= 70 && peakC >= entryC + 12) {
    const trailC = isBreakoutSurge ? 8 : (isPinStall ? 4 : 6);
    if (dropC >= trailC || bidC <= 64) {
      return {
        action: 'EXIT_PROFIT_LOCK',
        tier: 'STEP_RATCHET_64C',
        reason: `ANGEL WINGS 64c HIGH-PEAK LOCK (entry ${entryC}c -> peak ${peakC}c -> bid ${bidC}c)`
      };
    }
  }

  // Tier 0A: Micro-Lotto Shield (<= 12c entry -> arms @ 15c+, 4c trail; subject to bid >= entry+4c)
  if (entryC <= 12) {
    if (peakC >= 15 && dropC >= 4) {
      return {
        action: 'EXIT_PROFIT_LOCK',
        tier: 'MICRO_LOTTO_15C',
        reason: `ANGEL WINGS MICRO-LOTTO LOCK (entry ${entryC}c -> peak ${peakC}c -> bid ${bidC}c)`
      };
    }
    return null;
  }

  // Tier 0B: Low-Entry Theta-Pin Shield (13c-25c entry -> arms @ 42c+, 6c trail / 36c floor;
  // tightens to 4c trail / 38c floor in THETA_PIN adverse flow, widens to 8c in aligned BREAKOUT)
  if (entryC <= 25) {
    if (peakC >= 42) {
      const trailC = isPinStall ? 4 : (isBreakoutSurge ? 8 : 6);
      const floorC = isPinStall ? 38 : 36;
      if (dropC >= trailC || bidC <= floorC) {
        return {
          action: 'EXIT_PROFIT_LOCK',
          tier: isPinStall ? 'THETA_PIN_TIGHT' : 'THETA_PIN_42C',
          reason: `ANGEL WINGS THETA-PIN 42c LOCK (entry ${entryC}c -> peak ${peakC}c -> bid ${bidC}c)`
        };
      }
    }
    return null;
  }

  // Tier 0C: 50s-Floor Runner Shield (26c-45c entry -> arms @ 55c+, 6c trail / 52c floor)
  if (entryC <= 45) {
    if (peakC >= 55) {
      const trailC = isPinStall ? 4 : (isBreakoutSurge ? 8 : 6);
      if (dropC >= trailC || bidC <= 52) {
        return {
          action: 'EXIT_PROFIT_LOCK',
          tier: 'RUNNER_50S_FLOOR',
          reason: `ANGEL WINGS 50s-FLOOR TRAIL LOCK (entry ${entryC}c -> peak ${peakC}c -> bid ${bidC}c)`
        };
      }
    }
    return null;
  }

  // Tier 2: Directional Entry (> 45c -> arms @ entry+15c; tightens to 5c <= 60s left or pin stall)
  if (peakC >= entryC + 15) {
    const nearBell = Number.isFinite(timeLeftSec) && timeLeftSec <= 60;
    const trailC = (nearBell || isPinStall) ? 5 : 8;
    if (dropC >= trailC) {
      return {
        action: 'EXIT_PROFIT_LOCK',
        tier: nearBell ? 'DIRECTIONAL_BELL_LOCK' : (isPinStall ? 'DIRECTIONAL_STALL_LOCK' : 'DIRECTIONAL_TRAIL'),
        reason: `ANGEL WINGS PEAK-TRAIL SAVE (entry ${entryC}c -> peak ${peakC}c -> bid ${bidC}c)`
      };
    }
  }

  return null;
}

module.exports = { evaluateAngelWingsExit, toCents };
