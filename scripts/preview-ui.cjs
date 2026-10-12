// Isolated UI development server. Never calls ADB or changes device location.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { parseCoordinates } = require("../web/map-tools.js");
const { createPlaceSearch } = require("./preview-search.cjs");
const searchPlaces = createPlaceSearch();
const root = path.resolve(__dirname, "../web");
const port = Number(process.env.DINGDIAN_PREVIEW_PORT || 18766);
let session = null,
  appearance = "dark";
let updateState = "idle", updateStarted = 0;
function updateStatus() {
  const downloaded = updateState === "downloading" ? Math.min(2000000, Math.floor((Date.now() - updateStarted) / 5000 * 2000000)) : 0;
  if (downloaded === 2000000) updateState = "ready";
  return { state: updateState, currentVersion: "1.1.0", currentCode: 3, latestVersion: "1.2.0", hasUpdate: updateState !== "idle", size: 2000000, downloaded, canInstall: true, notes: "界面预览用的模拟版本。\n此操作不会连接 GitHub 下载或安装 APK。" };
}
const devices = [
  { serial: "preview-device", model: "Android 手机 · 界面预览", state: "device" },
];
const compatibility = {
  platform: "android", manufacturer: "模拟设备", model: "Android 手机", android: "16", sdk: 36,
  precise_location: true, mock_app: true, location_enabled: true, notifications: true, battery_unrestricted: false,
  guidance: "界面预览：授权结果为模拟。若切后台后停止刷新，可从权限与后台设置中检查电量限制。",
};
function dispatch(endpoint, data = {}) {
  switch (endpoint) {
    case "status":
      return {
        devices,
        preview: true,
        ready: true,
        setup: "预览设备已就绪；此预览不会修改手机定位。",
        compatibility,
        active: !!session,
        session,
        last_refresh: new Date().toISOString(),
      };
    case "probe":
      return {
        model: "Android 手机 · 界面预览",
        android: "16",
        hyperos: "HyperOS 3.0",
        interface: "预览连接正常，不操作真实设备。",
      };
    case "places/search":
      return searchPlaces(data.query);
    case "location/current":
      if (session) throw new Error("请先恢复真实定位。");
      if (data.fail || process.env.DINGDIAN_PREVIEW_LOCATION === "error") throw new Error("预览：当前位置获取失败，可手动选点。");
      return new Promise(resolve => setTimeout(() => resolve({latitude:39.9042,longitude:116.4074,accuracy:12,source:"preview"}), data.delay ? 1500 : 0));
    case "location/set": {
      const coordinate = parseCoordinates(`${data.latitude},${data.longitude}`);
      if (!coordinate) throw new Error("请输入有效坐标。");
      session = {
        serial: "preview-device",
        ...coordinate,
        providers: data.network ? ["gps", "network"] : ["gps"],
      };
      return { ok: true };
    }
    case "location/reset":
    case "shutdown":
      session = null;
      return { ok: true };
    case "appearance/theme":
      appearance = data.dark ? "dark" : "light";
      return { ok: true };
    case "settings/mock":
    case "settings/app":
    case "settings/location":
      return { ok: true };
    case "updates/status": return updateStatus();
    case "updates/check": updateState = "available"; return updateStatus();
    case "updates/download": updateState = "downloading"; updateStarted = Date.now(); return updateStatus();
    case "updates/install":
      if (session) throw new Error("请先恢复真实定位，再安装更新。");
      throw new Error("这是界面预览。真实手机会打开系统安装确认页面。");
    case "preview/state":
      return { session, appearance };
    default:
      throw new Error("预览接口不存在。");
  }
}
http
  .createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org https://webst02.is.autonavi.com; connect-src 'self'; frame-ancestors 'none'; object-src 'none'",
      );
      response.setHeader("Cache-Control", "no-store");
      if (url.pathname.startsWith("/api/")) {
        let body = "";
        for await (const part of request) {
          body += part;
          if (body.length > 16384) throw new Error("请求过长。");
        }
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify(
            await dispatch(url.pathname.slice(5), body ? JSON.parse(body) : {}),
          ),
        );
        return;
      }
      // Deterministic network-failure fixture; never contacts a device or tile service.
      if (/^\/preview-map-error\/[0-9]+\/[0-9]+\/[0-9]+\.png$/.test(url.pathname)) {
        response.writeHead(503, {"Content-Type": "text/plain"});
        response.end("Preview map network failure");
        return;
      }
      if (url.pathname === "/preview-native.js") {
        response.setHeader("Content-Type", "application/javascript");
        response.end(
          `window.DingDianNative={preview:true,mapTileTemplate:${JSON.stringify(url.searchParams.get("map") === "error" ? "/preview-map-error/{z}/{x}/{y}.png" : null)},request(id,endpoint,payload){if(endpoint==='location/current')payload=JSON.stringify({...JSON.parse(payload),fail:${url.searchParams.get("location") === "error"},delay:${url.searchParams.get("location") === "slow"}});fetch('/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:payload}).then(response=>response.json()).then(result=>NativeLocation.complete(id,result.error?result:{value:result})).catch(error=>NativeLocation.complete(id,{error:error.message}));}};`,
        );
        return;
      }
      const filename = path.resolve(
        root,
        "." + (url.pathname === "/" ? "/index.html" : url.pathname),
      );
      if (!filename.startsWith(root + path.sep)) {
        response.writeHead(403);
        response.end();
        return;
      }
      let content = await fs.readFile(filename);
      if (url.pathname === "/" && url.searchParams.get("mode") === "phone")
        content = content
          .toString()
          .replace(
            '<script defer src="/native-bridge.js">',
            `<script defer src="/preview-native.js?map=${url.searchParams.get('map') === 'error' ? 'error' : ''}&location=${['error','slow'].includes(url.searchParams.get('location')) ? url.searchParams.get('location') : ''}"></script><script defer src="/native-bridge.js">`,
          );
      response.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".css": "text/css",
          ".js": "application/javascript",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        }[path.extname(filename)] || "application/octet-stream",
      );
      response.end(content);
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(
      `界面预览：http://127.0.0.1:${port}（手机布局：/?mode=phone）；不会控制真实设备。`,
    ),
  );
