'use strict';

const assert = require('assert');
const { evaluateAngelWingsExit } = require('../src/policy');

// 1. Never exits at a loss
assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.30, peakBid: 0.60, curBid: 0.28 }), null);

// 2. Micro-Lotto (<= 12c entry -> arms @ 15c, 4c trail)
assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.10, peakBid: 0.14, curBid: 0.10 }), null);
assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.10, peakBid: 0.20, curBid: 0.16 }).tier, 'MICRO_LOTTO_15C');

// 3. Theta-Pin 42c Shield (13-25c entry -> lets runners fly, locks 6c drop or <= 36c floor)
assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.24, peakBid: 0.40, curBid: 0.33 }), null);
assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.24, peakBid: 0.71, curBid: 0.68 }), null);
assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.24, peakBid: 0.71, curBid: 0.65 }).tier, 'STEP_RATCHET_64C');
assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.20, peakBid: 0.44, curBid: 0.38 }).tier, 'THETA_PIN_42C');
assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.20, peakBid: 0.42, curBid: 0.36 }).tier, 'THETA_PIN_42C');

// 4. Regime-Adaptive tightening in THETA_PIN with adverse flow (4c trail instead of 6c!)
assert.strictEqual(
  evaluateAngelWingsExit({ avgCost: 0.20, peakBid: 0.46, curBid: 0.42, regime: 'THETA_PIN', flowAligned: false }).tier,
  'THETA_PIN_TIGHT'
);

// 5. Regime-Adaptive widening in BREAKOUT with aligned flow (lets 6c wiggle keep flying!)
assert.strictEqual(
  evaluateAngelWingsExit({ avgCost: 0.20, peakBid: 0.50, curBid: 0.44, regime: 'BREAKOUT', flowAligned: true }),
  null
);

// 6. Step-Ratchet 78c high-altitude lock (peak >= 84c)
assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.25, peakBid: 0.88, curBid: 0.83 }).tier, 'STEP_RATCHET_78C');

// 7. 50s-Floor Runner (26-45c entry)
assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.32, peakBid: 0.50, curBid: 0.42 }), null);
assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.32, peakBid: 0.59, curBid: 0.52 }).tier, 'RUNNER_50S_FLOOR');

// 8. Directional Conviction (> 45c entry) tightens near bell (<= 60s left -> 5c trail)
assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.55, peakBid: 0.72, curBid: 0.67, timeLeftSec: 200 }), null);
assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.55, peakBid: 0.72, curBid: 0.67, timeLeftSec: 45 }).tier, 'DIRECTIONAL_BELL_LOCK');

console.log('ALL 15 ANGEL WINGS v2 UNIT TESTS PASSED!');
