const HOST = "com.kiraa06.jobpilot";

// One native port per request; the helper handles one request and exits.
function callHost(action, payload) {
  let port;
  let settled = false;
  let resolveFn;
  const promise = new Promise((resolve) => { resolveFn = resolve; });
  const finish = (res) => { if (!settled) { settled = true; resolveFn(res); } };
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    finish({ ok: false, error: { code: "HOST_MISSING", message: String(e.message || e) } });
    return { promise, cancel() {} };
  }
  port.onMessage.addListener((msg) => { finish(msg); port.disconnect(); });
  port.onDisconnect.addListener(() => {
    const m = chrome.runtime.lastError?.message || "The helper stopped unexpectedly.";
    const code = /not found|forbidden/i.test(m) ? "HOST_MISSING" : "HOST_DISCONNECTED";
    finish({ ok: false, error: { code, message: m } });
  });
  port.postMessage({ action, payload });
  return {
    promise,
    cancel() {
      try { port.postMessage({ action: "cancel" }); port.disconnect(); } catch (_) { /* already gone */ }
      finish({ ok: false, error: { code: "CANCELLED", message: "Cancelled." } });
    },
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "host:ping") {
    callHost("ping", {}).promise.then(sendResponse);
    return true;
  }
  return false;
});
