(function (root) {
  // Open-licence fonts bundled in vendor/fonts/ for captured CV designs (see scripts/vendor.sh).
  // "look" is what Claude reads when picking the nearest match to the original CV's font.
  const v = (file, weight = "100 900") => ({ file, weight });
  const pair = (regular, bold) => [{ file: regular, weight: "400" }, { file: bold, weight: "700" }];
  const CATALOG = [
    { family: "Carlito", look: "metric-compatible with Calibri (default Word/Office sans)", files: pair("Carlito-Regular.ttf", "Carlito-Bold.ttf") },
    { family: "Arimo", look: "metric-compatible with Arial / Helvetica", files: [v("Arimo[wght].ttf", "400 700")] },
    { family: "Tinos", look: "metric-compatible with Times New Roman", files: pair("Tinos-Regular.ttf", "Tinos-Bold.ttf") },
    { family: "Caladea", look: "metric-compatible with Cambria (Office serif)", files: pair("Caladea-Regular.ttf", "Caladea-Bold.ttf") },
    { family: "Lato", look: "humanist sans, friendly and round", files: pair("Lato-Regular.ttf", "Lato-Bold.ttf") },
    { family: "Inter", look: "neo-grotesque UI sans, close to SF Pro / Helvetica Now", files: [v("Inter[opsz,wght].ttf")] },
    { family: "Roboto", look: "neo-grotesque sans (Android / Google Docs)", files: [v("Roboto[wdth,wght].ttf")] },
    { family: "Open Sans", look: "humanist sans, neutral (common in resume builders)", files: [v("OpenSans[wdth,wght].ttf", "300 800")] },
    { family: "Source Sans 3", look: "humanist sans, compact, close to Myriad / Segoe UI", files: [v("SourceSans3[wght].ttf", "200 900")] },
    { family: "Montserrat", look: "geometric sans, wide, used for bold modern headings", files: [v("Montserrat[wght].ttf")] },
    { family: "Raleway", look: "elegant thin geometric sans, often in headings", files: [v("Raleway[wght].ttf")] },
    { family: "Poppins", look: "geometric sans, round (Canva / modern templates)", files: pair("Poppins-Regular.ttf", "Poppins-Bold.ttf") },
    { family: "Nunito", look: "rounded sans", files: [v("Nunito[wght].ttf", "200 1000")] },
    { family: "Work Sans", look: "grotesque sans, slightly wide", files: [v("WorkSans[wght].ttf")] },
    { family: "PT Sans", look: "humanist sans, slightly condensed", files: pair("PT_Sans-Web-Regular.ttf", "PT_Sans-Web-Bold.ttf") },
    { family: "Merriweather", look: "sturdy screen serif", files: [v("Merriweather[opsz,wdth,wght].ttf", "300 900")] },
    { family: "Lora", look: "contemporary calligraphic serif", files: [v("Lora[wght].ttf", "400 700")] },
    { family: "EB Garamond", look: "classic Garamond serif (LaTeX / academic CVs)", files: [v("EBGaramond[wght].ttf", "400 800")] },
    { family: "Source Serif 4", look: "transitional serif, close to Georgia / Charter", files: [v("SourceSerif4[opsz,wght].ttf", "200 900")] },
    { family: "Playfair Display", look: "high-contrast display serif for names/headings", files: [v("PlayfairDisplay[wght].ttf", "400 900")] },
    { family: "Roboto Mono", look: "monospace", files: [v("RobotoMono[wght].ttf", "100 700")] },
  ];
  const FAMILIES = CATALOG.map((f) => f.family);
  // What the helper sends to Claude.
  const forPrompt = () => CATALOG.map(({ family, look }) => ({ family, look }));

  const api = { CATALOG, FAMILIES, forPrompt };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.JobPilot = root.JobPilot || {}).fonts = api;
})(globalThis);
