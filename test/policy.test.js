'use strict';

const assert = require('assert');
const { evaluateAngelWingsExit } = require('../src/policy');
const { AngelWingsGuardian } = require('../src/guardian');

async function run() {
  // === PART A: INTEGER-CENT POLICY BOUNDARY TESTS ===
  assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.30, peakBid: 0.60, curBid: 0.28 }), null);
  // 0.124 rounds to 12c -> Micro-Lotto (NOT Theta-Pin!)
  assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.124, peakBid: 0.20, curBid: 0.16 }).tier, 'MICRO_LOTTO_15C');
  // 0.251 rounds to 25c -> Theta-Pin (arms at 42c!)
  assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.251, peakBid: 0.44, curBid: 0.38 }).tier, 'THETA_PIN_42C');
  // 0.695 rounds to 70c -> arms 64c Step-Ratchet!
  assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.24, peakBid: 0.695, curBid: 0.64 }).tier, 'STEP_RATCHET_64C');
  // 0.835 rounds to 84c -> arms 78c Step-Ratchet!
  assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.24, peakBid: 0.835, curBid: 0.78 }).tier, 'STEP_RATCHET_78C');
  // Displayed 6c fade (43c -> 37c from floats 0.425 -> 0.366) triggers reliably in integer cents!
  assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.20, peakBid: 0.425, curBid: 0.366 }).tier, 'THETA_PIN_42C');
  // Regime-adaptive tighten & widen
  assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.20, peakBid: 0.46, curBid: 0.42, regime: 'THETA_PIN', flowAligned: false }).tier, 'THETA_PIN_TIGHT');
  assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.20, peakBid: 0.50, curBid: 0.44, regime: 'BREAKOUT', flowAligned: true }), null);
  // Directional stall label distinct from bell lock (below 70c high-altitude ratchet)
  assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.50, peakBid: 0.66, curBid: 0.61, timeLeftSec: 200, regime: 'THETA_PIN', flowAligned: false }).tier, 'DIRECTIONAL_STALL_LOCK');
  assert.strictEqual(evaluateAngelWingsExit({ avgCost: 0.50, peakBid: 0.66, curBid: 0.61, timeLeftSec: 45 }).tier, 'DIRECTIONAL_BELL_LOCK');

  // === PART B: GUARDIAN CONCURRENCY, SCALE-IN & ANTI-DUPLICATE-SELL TESTS ===
  let sells = [];
  let qty = 40;
  let bid = 0.24;
  const mockAdapter = {
    async fetchUnlockedPositions() {
      return qty > 0 ? [{ venue: 'poly', slug: 'btc-5m', side: 'NO', unlockedQty: qty, avgCost: 0.24, timeLeftSec: 180 }] : [];
    },
    async fetchBestBid() { return bid; },
    async executeImmediateSell(order) {
      sells.push(order);
      return { filledQty: order.qty };
    }
  };

  const alerts = [];
  const g = new AngelWingsGuardian({ adapter: mockAdapter, live: true, pollMs: 150, onAlert: (m) => alerts.push(m) });

  // Tick 1: entry 24c -> peak 71c -> pullback 65c -> MUST fire ONCE with IOC + reduceOnly!
  await g.tick();
  bid = 0.71; await g.tick();
  bid = 0.65; await g.tick();
  assert.strictEqual(sells.length, 1);
  assert.strictEqual(sells[0].timeInForce, 'IOC');
  assert.strictEqual(sells[0].reduceOnly, true);
  assert.strictEqual(sells[0].limitBid, 0.64);

  // Stale exchange snapshot still reports qty=40 after cooldown -> MUST NOT double-sell!
  g.tracked.get('poly:btc-5m:NO').lastExitAt = 0;
  await g.tick();
  assert.strictEqual(sells.length, 1, 'Stale qty snapshot must not trigger duplicate sell');

  // Scale-in resets peakBid so newly added size does NOT immediately dump on old 71c peak!
  qty = 60;
  bid = 0.45;
  await g.tick();
  assert.strictEqual(g.tracked.get('poly:btc-5m:NO').peakBid, 0.45);
  assert.strictEqual(sells.length, 1);

  // Double start() returns the exact same loop promise (single-flight!)
  const p1 = g.start();
  const p2 = g.start();
  assert.strictEqual(p1, p2);
  g.stop();
  await p1;

  console.log('ALL 19 POLICY + GUARDIAN CONCURRENCY TESTS PASSED!');
}

run().catch((e) => { console.error(e); process.exit(1); });
