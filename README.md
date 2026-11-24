# Angel Wings — 250ms Non-Locking Trailing Profit Shield for Polymarket & Kalshi

> **Locks the exit, not your trade.**  
> Stop watching 24¢ → 71¢ bounces round-trip back to 0¢ because neither Polymarket nor Kalshi offers a native trailing profit stop that leaves your phone's Cash Out button free.

![Angel Wings Poster](docs/assets/angel_wings_banner.jpg)

### Don't Want to Run Node.js or Keep a Laptop Awake 24/7?
> **Angel Wings Cloud Co-Pilot (Waitlist Open):** Non-custodial, trade-only API key (zero withdrawal permissions), 24/7 offline protection even when your cell signal drops, SMS/Telegram alerts, and 1-click presets.  
> Open [docs/waitlist.html](docs/waitlist.html) to preview the hosted Co-Pilot waitlist page.

---

## Why Angel Wings Exists

Manual prediction-market traders on 5-minute, 15-minute, and 1-hour markets face two brutal traps:
1. **No Native Trailing Stop:** Resting a GTC limit sell freezes your shares so your phone app's manual **Cash Out** button gets locked.
2. **Human Reaction Latency & Dropped Signal:** In fast binary snapbacks, a `24¢ → 71¢` spike can dump back to `0¢` in seconds — or while your phone loses signal inside a store.

**Angel Wings solves both:**
- **Zero Resting GTC Sell Orders:** Polls live L2 order books at `250ms` (4x/sec). Your mobile Cash Out button remains 100% unlocked at all times.
- **Downside-Only Profit Shield:** NEVER sells at a loss (`curBid >= avgCost + 4¢` hard invariant).
- **Regime-Adaptive Step-Ratchet (`v2`):** Lets real winners fly (`24¢ → 71¢ → 88¢`) while ratcheting protective floors underneath (`36¢ → 52¢ → 64¢ → 78¢`).

![Angel Wings 404ms Proof Chart](docs/assets/angel_wings_chart.jpg)

---

## Adaptive Trailing Tiers (`src/policy.js`)

| Tier | Entry Price | Arms At | Trail / Floor | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Micro-Lotto (`0A`)** | `<= 12¢` | `>= 15¢` | `4¢` peak trail | Protects low-cost lottery bounces |
| **Theta-Pin (`0B`)** | `13¢ – 25¢` | `>= 42¢` | `6¢` trail (`4¢` in pin stall) / `36¢` floor | Prevents 2x+ bounces from dying to `0¢` |
| **50s Runner (`0C`)** | `26¢ – 45¢` | `>= 55¢` | `6¢` trail / `52¢` floor | Ignores early chop; rides `60¢–90¢` |
| **Step-Ratchet (`1`)** | Any | `>= 70¢` / `>= 84¢` | `64¢` / `78¢` floor lock | Locks high-altitude runners automatically |
| **Directional (`2`)** | `> 45¢` | `entry + 15¢` | `8¢` trail (`5¢` if `<= 60s` left) | Guards conviction trades into the bell |

---

## Quickstart (Safe `DRY_RUN=1` Default)

```bash
git clone https://github.com/jw83252014-creator/angel-wings.git
cd angel-wings
cp .env.example .env
npm test          # Runs all 15 deterministic policy tests
npm start         # Runs in safe DRY_RUN mode (zero live orders)
```

To enable live execution after wiring your trade-only venue adapter:
```bash
ANGEL_WINGS_LIVE=1 npm start
```

## Security & Disclaimer
- **Non-Custodial:** Use strictly **trade-only, zero-withdrawal** API keys.
- **Risk Tool, Not a Guarantee:** Binary prediction markets can gap rapidly through limit bids during thin liquidity or macro prints. Always test in `DRY_RUN` first.
- Licensed under [MIT](LICENSE).
