'use strict';

/**
 * Angel Wings v2 — Single-Flight 250ms Non-Locking Guardian Engine
 * =================================================================
 * Hardened per Grok 4.7 Build Security & Concurrency Audit (2026-11-24):
 *   - Single-loop enforcement (`start()` is idempotent; no duplicate poll loops)
 *   - Per-position `inFlight` latch + unique `clientOrderId` + `reduceOnly: true`
 *   - Mandatory `timeInForce: 'IOC'` so adapters never leave resting GTC sell orders
 *   - Wait-for-qty-drop dedupe so stale exchange snapshots never double-sell
 *   - Automatic `peakBid` reset when `unlockedQty` increases (scale-in protection!)
 *   - Re-reads live bid immediately before order dispatch (post-`regimeProvider`)
 *   - Confirms `filledQty > 0` before logging `SAVED`
 */

const crypto = require('crypto');
const { evaluateAngelWingsExit } = require('./policy');

class AngelWingsGuardian {
  constructor({ adapter, regimeProvider = null, live = false, pollMs = 250, onAlert = console.log }) {
    if (!adapter) throw new Error('AngelWingsGuardian requires a venue adapter');
    this.adapter = adapter;
    this.regimeProvider = regimeProvider;
    this.live = Boolean(live);
    this.pollMs = Math.max(150, Number(pollMs || 250));
    this.onAlert = onAlert;
    this.tracked = new Map();
    this.running = false;
    this._loopPromise = null;
    this._sleepTimer = null;
  }

  async tick() {
    const positions = (await this.adapter.fetchUnlockedPositions()) || [];
    const activeKeys = new Set();

    for (const pos of positions) {
      const key = `${pos.venue}:${pos.slug}:${pos.side}`;
      try {
        if (!(pos.unlockedQty > 0) || !(pos.avgCost > 0 && pos.avgCost < 1)) continue;
        activeKeys.add(key);

        let curBid = await this.adapter.fetchBestBid(pos.venue, pos.slug, pos.side);
        if (!(curBid > 0 && curBid < 1)) continue;

        let st = this.tracked.get(key);
        if (!st) {
          st = {
            ...pos,
            peakBid: curBid,
            inFlight: false,
            awaitingQtyDropFrom: null,
            lastExitAt: 0
          };
          this.tracked.set(key, st);
          this.onAlert(`[ANGEL WINGS WATCHING] ${key} qty=${pos.unlockedQty} avg=${Math.round(pos.avgCost * 100)}c bid=${Math.round(curBid * 100)}c`);
        } else {
          // Clear awaitingQtyDrop latch once exchange snapshot reflects reduced qty
          if (st.awaitingQtyDropFrom !== null && pos.unlockedQty < st.awaitingQtyDropFrom) {
            st.awaitingQtyDropFrom = null;
          }
          // Scale-in protection: reset peakBid if user added size or avgCost shifted meaningfully
          const scaledIn = pos.unlockedQty > st.unlockedQty + 1e-6 || Math.abs(pos.avgCost - st.avgCost) >= 0.01;
          st.unlockedQty = pos.unlockedQty;
          st.avgCost = pos.avgCost;
          st.timeLeftSec = pos.timeLeftSec;
          if (scaledIn) {
            st.peakBid = curBid;
            st.awaitingQtyDropFrom = null;
          } else if (curBid > st.peakBid) {
            st.peakBid = curBid;
          }
        }

        if (st.inFlight) continue;
        if (st.awaitingQtyDropFrom !== null && pos.unlockedQty >= st.awaitingQtyDropFrom) continue;
        if (Date.now() - st.lastExitAt < 4000) continue;

        const ctx = this.regimeProvider ? await this.regimeProvider(pos) : { regime: 'NORMAL', flowAligned: null };

        // Re-verify fresh bid immediately after async regimeProvider
        const freshBid = await this.adapter.fetchBestBid(pos.venue, pos.slug, pos.side);
        if (!(freshBid > 0 && freshBid < 1)) continue;
        curBid = freshBid;
        if (curBid > st.peakBid) st.peakBid = curBid;

        const decision = evaluateAngelWingsExit({
          avgCost: st.avgCost,
          peakBid: st.peakBid,
          curBid,
          timeLeftSec: st.timeLeftSec,
          regime: ctx?.regime || 'NORMAL',
          flowAligned: ctx?.flowAligned ?? null
        });

        if (!decision) continue;

        st.inFlight = true;
        st.lastExitAt = Date.now();
        const limitBid = Math.max(0.01, (Math.round(curBid * 100) - 1) / 100);
        const clientOrderId = `aw-${crypto.randomBytes(6).toString('hex')}`;

        try {
          if (!this.live) {
            this.onAlert(`[ANGEL WINGS DRY-RUN] Would IOC-sell ${st.unlockedQty}x ${key} @ ${Math.round(limitBid * 100)}c — ${decision.reason}`);
            st.awaitingQtyDropFrom = st.unlockedQty;
          } else {
            const t0 = Date.now();
            const res = await this.adapter.executeImmediateSell({
              clientOrderId,
              venue: st.venue,
              slug: st.slug,
              side: st.side,
              qty: st.unlockedQty,
              limitBid,
              timeInForce: 'IOC',
              reduceOnly: true
            });
            const filledQty = Number(res?.filledQty || 0);
            if (filledQty > 0) {
              st.awaitingQtyDropFrom = st.unlockedQty;
              this.onAlert(`[ANGEL WINGS SAVED ${filledQty}x in ${Date.now() - t0}ms] ${key} — ${decision.reason}`);
            } else {
              this.onAlert(`[ANGEL WINGS UNFILLED/REJECTED] ${key} (${clientOrderId}): ${JSON.stringify(res)}`);
            }
          }
        } finally {
          st.inFlight = false;
        }
      } catch (err) {
        this.onAlert(`[ANGEL WINGS POS WARN] ${key}: ${err.message}`);
      }
    }

    for (const k of Array.from(this.tracked.keys())) {
      if (!activeKeys.has(k)) this.tracked.delete(k);
    }
  }

  start() {
    if (this._loopPromise) return this._loopPromise;
    this.running = true;
    this.onAlert(`[ANGEL WINGS] Started mode=${this.live ? 'LIVE' : 'DRY_RUN'} poll=${this.pollMs}ms (IOC reduce-only, single-flight)`);
    this._loopPromise = (async () => {
      while (this.running) {
        try {
          await this.tick();
        } catch (err) {
          this.onAlert(`[ANGEL WINGS LOOP WARN] ${err.message}`);
        }
        if (!this.running) break;
        await new Promise((resolve) => {
          this._sleepTimer = setTimeout(resolve, this.pollMs);
        });
      }
      this._loopPromise = null;
    })();
    return this._loopPromise;
  }

  stop() {
    this.running = false;
    if (this._sleepTimer) {
      clearTimeout(this._sleepTimer);
      this._sleepTimer = null;
    }
  }
}

module.exports = { AngelWingsGuardian };
