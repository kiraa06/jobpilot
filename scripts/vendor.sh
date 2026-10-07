#!/usr/bin/env bash
# Downloads vendored libraries/fonts and verifies SHA-256. Re-run to restore extension/vendor/.
set -euo pipefail
cd "$(dirname "$0")/../extension/vendor"
mkdir -p fonts
fetch() { # url dest sha256
  curl -fsSL "$1" -o "$2"
  echo "$3  $2" | shasum -a 256 -c -
}
fetch https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js pdf-lib.min.js \
  0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f
fetch https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js fontkit.umd.min.js \
  d8df561b9fba98e24f2e5130e40948809281bbbc55a20c412359f1a0a5eb35a6
fetch https://raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-Regular.ttf fonts/Lato-Regular.ttf \
  d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251
fetch https://raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-Bold.ttf fonts/Lato-Bold.ttf \
  8a0aace75d33794eece4b28187bfc1df0bbd2888b5d8a56e01788c8d65d16be1
curl -fsSL https://raw.githubusercontent.com/google/fonts/main/ofl/lato/OFL.txt -o fonts/OFL.txt
cat > LICENSES.md <<'EOF'
- pdf-lib 1.17.1 — MIT — https://github.com/Hopding/pdf-lib
- @pdf-lib/fontkit 1.1.1 — MIT — https://github.com/Hopding/fontkit
- Lato — SIL Open Font License 1.1 — fonts/OFL.txt
EOF
echo "✓ vendor files verified"
