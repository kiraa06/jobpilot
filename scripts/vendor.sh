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
# Fonts for captured CV designs (extension/lib/fonts.js).
FONTS=https://cdn.jsdelivr.net/gh/google/fonts@main
fetch "$FONTS/ofl/inter/Inter%5Bopsz,wght%5D.ttf" "fonts/Inter[opsz,wght].ttf" \
  29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031
fetch "$FONTS/ofl/roboto/Roboto%5Bwdth,wght%5D.ttf" "fonts/Roboto[wdth,wght].ttf" \
  d7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134
fetch "$FONTS/ofl/opensans/OpenSans%5Bwdth,wght%5D.ttf" "fonts/OpenSans[wdth,wght].ttf" \
  36643644f318a812aab2d2ed3bb98f8cf0872527f835fe9398d95fe6b9adb878
fetch "$FONTS/ofl/sourcesans3/SourceSans3%5Bwght%5D.ttf" "fonts/SourceSans3[wght].ttf" \
  042fe2cc0b933e328410d7acbd0aa6a1873dca5aef81875f4bc214b08825c7b9
fetch "$FONTS/ofl/montserrat/Montserrat%5Bwght%5D.ttf" "fonts/Montserrat[wght].ttf" \
  0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7
fetch "$FONTS/ofl/raleway/Raleway%5Bwght%5D.ttf" "fonts/Raleway[wght].ttf" \
  8bbcc3eb8275c388f4bcd998832f8a4b943eadbaf6a595205312774b5951aefb
fetch "$FONTS/ofl/merriweather/Merriweather%5Bopsz,wdth,wght%5D.ttf" "fonts/Merriweather[opsz,wdth,wght].ttf" \
  d0ed0e359e396af7ad05e73dffd11a3a4c326ea0d0283c56bd9361cb2cc86a96
fetch "$FONTS/ofl/lora/Lora%5Bwght%5D.ttf" "fonts/Lora[wght].ttf" \
  822a6621ccbe8d97d20ac88c1c41f5615c9c2c202eaa75f272cd452aac6475a7
fetch "$FONTS/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf" "fonts/EBGaramond[wght].ttf" \
  ef9512f92f6d579e5dc75af59a5a4b1b8b47d2eda89e00b954d44520e5369027
fetch "$FONTS/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf" "fonts/PlayfairDisplay[wght].ttf" \
  c40f2293766a503bc70cce9e512ef844a4ccb7cbcde792fe2ea31d191917d8d6
fetch "$FONTS/ofl/sourceserif4/SourceSerif4%5Bopsz,wght%5D.ttf" "fonts/SourceSerif4[opsz,wght].ttf" \
  97b2d4da6e3cb494b5a1e66ae176914d852ccabef49e0c02c0df25f3e39aca0b
fetch "$FONTS/ofl/robotomono/RobotoMono%5Bwght%5D.ttf" "fonts/RobotoMono[wght].ttf" \
  66a80e79d17e4c7cabd162e2916578a4cc08fd19eef6e2a643305eae9c567b2b
fetch "$FONTS/ofl/poppins/Poppins-Regular.ttf" "fonts/Poppins-Regular.ttf" \
  7e65201e9b79159e2300267cc885e16c8dcef2424cdfa09a29bfb0980a94a7ba
fetch "$FONTS/ofl/poppins/Poppins-Bold.ttf" "fonts/Poppins-Bold.ttf" \
  983676516167748b74de6f4771fb384c664fd913acb8b471122ecacf5da5ea6c
fetch "$FONTS/ofl/nunito/Nunito%5Bwght%5D.ttf" "fonts/Nunito[wght].ttf" \
  bb55a5ca5c2042335b3991af27c4d0705d0ef41cac6164ac737fd8f2a1e85207
fetch "$FONTS/ofl/worksans/WorkSans%5Bwght%5D.ttf" "fonts/WorkSans[wght].ttf" \
  f50f61f2ba738e239442d40bf1069adb195c224b6a5a73a581fc2f3ed62a9f63
fetch "$FONTS/ofl/carlito/Carlito-Regular.ttf" "fonts/Carlito-Regular.ttf" \
  f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595
fetch "$FONTS/ofl/carlito/Carlito-Bold.ttf" "fonts/Carlito-Bold.ttf" \
  bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db
fetch "$FONTS/ofl/caladea/Caladea-Regular.ttf" "fonts/Caladea-Regular.ttf" \
  f1e899278b7b4491aba5b6a8253c4b04c050cc59b21865be5c37559a775153cd
fetch "$FONTS/ofl/caladea/Caladea-Bold.ttf" "fonts/Caladea-Bold.ttf" \
  ae3cb2dcbc925809dd29d2a44e9802211cab66be541bacbfc9c08c74b27c3742
fetch "$FONTS/ofl/arimo/Arimo%5Bwght%5D.ttf" "fonts/Arimo[wght].ttf" \
  e43898b143ec826ac8cb4034816458a7047fbe0836558de2a1f8c6223ae3e0ca
fetch "$FONTS/ofl/tinos/Tinos-Regular.ttf" "fonts/Tinos-Regular.ttf" \
  60a0e8ef0c04dd5dd69ffe91025fa2ae5836cbd35600a82ba031977557e2cb61
fetch "$FONTS/ofl/tinos/Tinos-Bold.ttf" "fonts/Tinos-Bold.ttf" \
  393269dbab8899f938db19783eca5eac92eb431f7ae0ab45b8349ca895f1a06b
fetch "$FONTS/ofl/ptsans/PT_Sans-Web-Regular.ttf" "fonts/PT_Sans-Web-Regular.ttf" \
  9cc831490532009bae2b3ce0d39c62adfc889060beb421593bfd9d2396d0f10a
fetch "$FONTS/ofl/ptsans/PT_Sans-Web-Bold.ttf" "fonts/PT_Sans-Web-Bold.ttf" \
  3128bd5ecf01816e59a23d54c57a7a6b14615b07db53ff277c77376010265b05
cat > LICENSES.md <<'EOF'
- pdf-lib 1.17.1 — MIT — https://github.com/Hopding/pdf-lib
- @pdf-lib/fontkit 1.1.1 — MIT — https://github.com/Hopding/fontkit
- Lato — SIL Open Font License 1.1 — fonts/OFL.txt
- Inter, Roboto, Open Sans, Source Sans 3, Montserrat, Raleway, Merriweather, Lora, EB Garamond,
  Playfair Display, Source Serif 4, Roboto Mono, Poppins, Nunito, Work Sans, Carlito, Caladea, Arimo,
  Tinos, PT Sans — SIL Open Font License 1.1 (same text as fonts/OFL.txt) — https://github.com/google/fonts
EOF
echo "✓ vendor files verified"
