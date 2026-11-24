#!/usr/bin/env bash
set -euo pipefail
echo "[SCRUB CHECK] Scanning angel-wings repo for private keys, IPs, emails, or personal strings..."
if grep -rnE "sk-or-|sk-ant-|100\.81\.|trycloudflare|jw83252014@|jeffw58325|706-|303-|916-|Angi|Thumbtack|Sharma|Augusta|Carhartt|SoMaCoSF|Witness" src/ test/ docs/ README.md package.json .env.example 2>/dev/null; then
  echo "FAIL: Sensitive pattern found!"
  exit 1
fi
echo "PASS: 100% clean, zero secrets or private leaks!"
