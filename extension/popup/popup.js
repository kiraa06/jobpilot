document.getElementById("ping").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "host:ping" });
  document.getElementById("out").textContent = JSON.stringify(res, null, 2);
});
