// Print target for captured CV designs. The background attaches the debugger to this tab,
// calls __jobpilotRender(html) and prints the result with Page.printToPDF.
(function () {
  function fontFaceCss() {
    return JobPilot.fonts.CATALOG.flatMap((f) => f.files.map((file) =>
      `@font-face{font-family:"${f.family}";src:url("${chrome.runtime.getURL(`vendor/fonts/${file.file}`)}");` +
      `font-weight:${file.weight};font-style:${file.style || "normal"};font-display:block}`)).join("\n");
  }

  // html is an already-rendered, linted template; it is parsed inertly and never runs script.
  globalThis.__jobpilotRender = async function (html, title) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const fonts = doc.createElement("style");
    fonts.textContent = fontFaceCss();
    doc.head.prepend(fonts);
    for (const el of doc.querySelectorAll("script")) el.remove();
    document.replaceChild(document.importNode(doc.documentElement, true), document.documentElement);
    document.title = title || "CV";
    void document.body.offsetHeight; // force style + layout so used fonts start loading
    await document.fonts.ready;
    await Promise.all([...document.fonts].filter((f) => f.status === "loading").map((f) => f.loaded.catch(() => null)));
    return { text: document.body.innerText };
  };
})();
