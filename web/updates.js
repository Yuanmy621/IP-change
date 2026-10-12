// Runs only in the installed Android app; the Mac controller has its own releases.
(() => {
  if (!window.NativeLocation) return;
  const el = (id) => document.getElementById(id);
  let loading = false, lastState = null, actionError = "", permissionHint = false;
  el("updateSection").hidden = false;
  function render(value) {
    lastState = value;
    const state = value.state, working = state === "checking" || state === "downloading";
    const preview = document.getElementById("runtimeMode").textContent === "界面预览";
    el("updateSection").hidden = false;
    el("updatePreview").hidden = !preview;
    el("updateCurrent").textContent = `v${value.currentVersion}`;
    const percent = value.size ? Math.min(100, Math.floor(value.downloaded * 100 / value.size)) : 0;
    const messages = {
      idle: "从 GitHub Release 获取最新版本。",
      checking: "正在检查最新版本…",
      current: `当前 v${value.currentVersion} 已是最新版本。`,
      available: `发现 v${value.latestVersion} · ${(value.size / 1024 / 1024).toFixed(1)} MB`,
      downloading: `正在下载 v${value.latestVersion} · ${percent}%`,
      ready: "下载与校验完成，可以安装更新。",
      error: value.error || "更新失败，请重试。",
    };
    if (value.canInstall) permissionHint = false;
    el("updateMessage").textContent = actionError || (permissionHint ? "请允许定点安装应用，返回后再次点击安装更新。" : messages[state] || messages.idle);
    el("updateMessage").classList.toggle("update-error", state === "error" || !!actionError);
    el("updateCheck").disabled = loading || working;
    el("updateCheck").textContent = state === "checking" ? "检查中…" : "检查更新";
    el("updateDownload").hidden = !value.hasUpdate || state === "ready" || state === "checking";
    el("updateDownload").disabled = loading || working;
    el("updateDownload").textContent = state === "error" ? "重试下载" : state === "downloading" ? "下载中…" : "下载更新";
    el("updateInstall").hidden = state !== "ready";
    const hasSession = typeof status !== "undefined" && !!status?.session;
    el("updateInstall").disabled = loading || hasSession;
    el("updateInstall").textContent = hasSession ? "请先恢复定位" : value.canInstall ? "安装更新" : "授权安装更新";
    el("updateProgress").hidden = state !== "downloading";
    el("updateProgress").value = percent;
    el("updateDetails").hidden = !value.hasUpdate || !value.notes;
    el("updateNotes").textContent = value.notes || "";
  }
  async function request(action) {
    if (loading) return;
    if (action !== "status") actionError = "";
    loading = true;
    if (lastState) render(lastState);
    try {
      const value = await NativeLocation.request(`updates/${action}`);
      if (action === "install" && !value.canInstall) permissionHint = true;
      loading = false; render(value);
    } catch (error) {
      loading = false;
      actionError = error.message;
      if (lastState) render(lastState);
      el("updateMessage").textContent = error.message;
      el("updateMessage").classList.add("update-error");
    }
  }
  for (const [id, action] of [["updateCheck", "check"], ["updateDownload", "download"], ["updateInstall", "install"]])
    el(id).addEventListener("click", () => request(action));
  el("settingsDialog").addEventListener("wa-show", () => {
    if (lastState) render(lastState);
    request("status");
  });
  // Polling resumes after returning from Android's install-permission settings.
  setInterval(() => {
    if (!document.hidden && el("settingsDialog").open) request("status");
  }, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) request("status"); });
  request("status");
})();
