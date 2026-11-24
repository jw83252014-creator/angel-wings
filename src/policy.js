'use strict';

/**
 * Angel Wings v2 — Deterministic, Regime-Adaptive Downside-Only Profit Shield
 * ============================================================================
 * Pure policy engine (zero network calls, zero side effects, 100% unit-testable).
 *
 * Core Invariants:
 *   1. NEVER exits at a loss (always requires curBid >= avgCost + minProfitLock).
 *   2. NEVER requires resting GTC sell orders (manual phone Cash Out stays unlocked).
 *   3. Auto-detects play style by entry price:
 *        - Tier 0A (<= 12c): Micro-Lotto shield (arms >= 15c, 4c trail)
 *        - Tier 0B (13-25c): Low-Entry Theta-Pin shield (arms >= 42c, 6c trail or <= 36c floor;
 *                            tightens to 4c trail in theta-pin chop if flow stalls)
 *        - Tier 0C (26-45c): 50s-Floor Runner shield (arms >= 55c, 6c trail or <= 52c floor)
 *        - Tier 1  (>= 70c peak): Step-Ratchet High-Peak lock (52c -> 65c -> 78c floors)
 *        - Tier 2  (> 45c directional entry): Standard profit trail (+15c peak, 8c pullback;
 *                            tightens to 5c if timeLeftSec <= 60 or adverse flow detected)
 */

const EPS = 1e-9;

function evaluateAngelWingsExit({
  avgCost,
  peakBid,
  curBid,
  timeLeftSec = 300,
  regime = 'NORMAL', // 'THETA_PIN' | 'BREAKOUT' | 'NORMAL'
  flowAligned = null // true (momentum with trade), false (flow against), null (unknown)
}) {
  if (![avgCost, peakBid, curBid].every(Number.isFinite)) return null;
  if (avgCost <= 0 || avgCost >= 1 || curBid <= 0 || curBid >= 1) return null;

  // Invariant 1: Downside-only profit shield — never crystallizes a loss
  if (curBid < avgCost + 0.04 - EPS) return null;

  const entryC = Math.round(avgCost * 100);
  const peakC = Math.round(peakBid * 100);
  const bidC = Math.round(curBid * 100);
  const drop = peakBid - curBid;

  // Regime-adaptive trail modifier
  const isPinStall = regime === 'THETA_PIN' && flowAligned === false;
  const isBreakoutSurge = regime === 'BREAKOUT' && flowAligned === true;

  // Step-ratchet high-altitude floor locks (applies once any trade rallies >= 70c!)
  if (peakBid >= 0.84 - EPS && peakBid >= avgCost + 0.12 - EPS) {
    const trail = isBreakoutSurge ? 0.07 : 0.05;
    if (drop >= trail - EPS || curBid <= 0.78 + EPS) {
      return {
        action: 'EXIT_PROFIT_LOCK',
        tier: 'STEP_RATCHET_78C',
        reason: `ANGEL WINGS 78c STEP-RATCHET (entry ${entryC}c -> peak ${peakC}c -> bid ${bidC}c)`
      };
    }
  } else if (peakBid >= 0.70 - EPS && peakBid >= avgCost + 0.12 - EPS) {
    const trail = isBreakoutSurge ? 0.08 : 0.06;
    if (drop >= trail - EPS || curBid <= 0.64 + EPS) {
      return {
        action: 'EXIT_PROFIT_LOCK',
        tier: 'STEP_RATCHET_64C',
        reason: `ANGEL WINGS HIGH-PEAK LOCK (entry ${entryC}c -> peak ${peakC}c -> bid ${bidC}c)`
      };
    }
  }

  // Tier 0A: Micro-Lotto Shield (<= 12c entry -> arms @ 15c+, 4c trail)
  if (avgCost <= 0.12 + EPS) {
    if (peakBid >= 0.15 - EPS && drop >= 0.04 - EPS) {
      return {
        action: 'EXIT_PROFIT_LOCK',
        tier: 'MICRO_LOTTO_15C',
        reason: `ANGEL WINGS MICRO-LOTTO LOCK (entry ${entryC}c -> peak ${peakC}c -> bid ${bidC}c)`
      };
    }
    return null;
  }

  // Tier 0B: Low-Entry Theta-Pin Shield (13c-25c entry -> arms @ 42c+, protects 2x bounces!)
  if (avgCost <= 0.25 + EPS) {
    if (peakBid >= 0.42 - EPS) {
      const trail = isPinStall ? 0.04 : (isBreakoutSurge ? 0.08 : 0.06);
      const floor = isPinStall ? 0.38 : 0.36;
      if (drop >= trail - EPS || curBid <= floor + EPS) {
        return {
          action: 'EXIT_PROFIT_LOCK',
          tier: isPinStall ? 'THETA_PIN_TIGHT' : 'THETA_PIN_42C',
          reason: `ANGEL WINGS THETA-PIN 42c LOCK (entry ${entryC}c -> peak ${peakC}c -> bid ${bidC}c)`
        };
      }
    }
    return null;
  }

  // Tier 0C: 50s-Floor Runner Shield (26c-45c entry -> arms @ 55c+, lets 60->90c fly!)
  if (avgCost <= 0.45 + EPS) {
    if (peakBid >= 0.55 - EPS) {
      const trail = isPinStall ? 0.04 : (isBreakoutSurge ? 0.08 : 0.06);
      if (drop >= trail - EPS || curBid <= 0.52 + EPS) {
        return {
          action: 'EXIT_PROFIT_LOCK',
          tier: 'RUNNER_50S_FLOOR',
          reason: `ANGEL WINGS 50s-FLOOR TRAIL LOCK (entry ${entryC}c -> peak ${peakC}c -> bid ${bidC}c)`
        };
      }
    }
    return null;
  }

  // Tier 2: Directional Conviction Entry (> 45c -> arms @ +15c, tighter near bell or adverse flow)
  if (peakBid >= avgCost + 0.15 - EPS) {
    const nearBell = Number.isFinite(timeLeftSec) && timeLeftSec <= 60;
    const trail = (nearBell || isPinStall) ? 0.05 : 0.08;
    if (drop >= trail - EPS) {
      return {
        action: 'EXIT_PROFIT_LOCK',
        tier: nearBell ? 'DIRECTIONAL_BELL_LOCK' : 'DIRECTIONAL_TRAIL',
        reason: `ANGEL WINGS PEAK-TRAIL SAVE (entry ${entryC}c -> peak ${peakC}c -> bid ${bidC}c)`
      };
    }
  }

  return null;
}

module.exports = { evaluateAngelWingsExit };
