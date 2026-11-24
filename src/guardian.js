'use strict';

/**
 * Angel Wings — 250ms Non-Locking Manual Position Guardian (Open-Source Core)
 * ============================================================================
 * Default Mode: DRY_RUN=1 (safe simulation; set ANGEL_WINGS_LIVE=1 to execute).
 *
 * Security & Non-Custodial Guarantees:
 *   - Uses ONLY user-supplied trade-only API credentials from local .env
 *   - NEVER holds withdrawal permissions or user funds
 *   - NEVER posts resting GTC sell orders (your mobile Cash Out button stays free!)
 */

const { evaluateAngelWingsExit } = require('./policy');

const LIVE_MODE = process.env.ANGEL_WINGS_LIVE === '1';
const POLL_MS = Math.max(150, Number(process.env.ANGEL_WINGS_POLL_MS || 250));

class AngelWingsGuardian {
  constructor({ adapter, regimeProvider = null, onAlert = console.log }) {
    this.adapter = adapter;
    this.regimeProvider = regimeProvider;
    this.onAlert = onAlert;
    this.tracked = new Map();
    this.running = false;
  }

  async tick() {
    const positions = await this.adapter.fetchUnlockedPositions();
    const activeKeys = new Set();

    for (const pos of positions) {
      if (!(pos.unlockedQty > 0) || !(pos.avgCost > 0 && pos.avgCost < 1)) continue;
      const key = `${pos.venue}:${pos.slug}:${pos.side}`;
      activeKeys.add(key);

      const curBid = await this.adapter.fetchBestBid(pos.venue, pos.slug, pos.side);
      if (!(curBid > 0 && curBid < 1)) continue;

      let st = this.tracked.get(key);
      if (!st) {
        st = { ...pos, peakBid: curBid, lastExitAt: 0 };
        this.tracked.set(key, st);
        this.onAlert(`[ANGEL WINGS WATCHING] ${key} qty=${pos.unlockedQty} avg=${Math.round(pos.avgCost * 100)}c bid=${Math.round(curBid * 100)}c`);
      } else {
        st.unlockedQty = pos.unlockedQty;
        st.avgCost = pos.avgCost;
        st.timeLeftSec = pos.timeLeftSec;
        if (curBid > st.peakBid) st.peakBid = curBid;
      }

      if (Date.now() - st.lastExitAt < 4000) continue;

      const ctx = this.regimeProvider ? await this.regimeProvider(pos) : { regime: 'NORMAL', flowAligned: null };
      const decision = evaluateAngelWingsExit({
        avgCost: st.avgCost,
        peakBid: st.peakBid,
        curBid,
        timeLeftSec: st.timeLeftSec,
        regime: ctx.regime,
        flowAligned: ctx.flowAligned
      });

      if (decision) {
        st.lastExitAt = Date.now();
        if (!LIVE_MODE) {
          this.onAlert(`[ANGEL WINGS DRY-RUN] Would sell ${st.unlockedQty}x ${key} @ ${Math.round(curBid * 100)}c — ${decision.reason}`);
        } else {
          const t0 = Date.now();
          const res = await this.adapter.executeImmediateSell({
            venue: st.venue,
            slug: st.slug,
            side: st.side,
            qty: st.unlockedQty,
            limitBid: Math.max(0.01, +(curBid - 0.01).toFixed(2))
          });
          this.onAlert(`[ANGEL WINGS SAVED in ${Date.now() - t0}ms] ${key} — ${decision.reason} | ${JSON.stringify(res)}`);
        }
      }
    }

    for (const k of Array.from(this.tracked.keys())) {
      if (!activeKeys.has(k)) this.tracked.delete(k);
    }
  }

  async start() {
    this.running = true;
    this.onAlert(`[ANGEL WINGS] Started mode=${LIVE_MODE ? 'LIVE' : 'DRY_RUN'} poll=${POLL_MS}ms (zero resting GTC orders)`);
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        this.onAlert(`[ANGEL WINGS WARN] ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  stop() {
    this.running = false;
  }
}

module.exports = { AngelWingsGuardian };

if (require.main === module) {
  console.log('Angel Wings v2 Core loaded. Wire a Polymarket US or Kalshi venue adapter or run `npm test` to verify all trailing-shield tiers.');
}
