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
const devices = [
  { serial: "preview-device", model: "Redmi K80 · 界面预览", state: "device" },
];
function dispatch(endpoint, data = {}) {
  switch (endpoint) {
    case "status":
      return {
        devices,
        preview: true,
        ready: true,
        setup: "预览设备已就绪；此预览不会修改手机定位。",
        active: !!session,
        session,
        last_refresh: new Date().toISOString(),
      };
    case "probe":
      return {
        model: "Redmi K80 · 界面预览",
        android: "16",
        hyperos: "HyperOS 3.0",
        interface: "预览连接正常，不操作真实设备。",
      };
    case "places/search":
      return searchPlaces(data.query);
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
      return { ok: true };
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
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none'; object-src 'none'",
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
      if (url.pathname === "/preview-native.js") {
        response.setHeader("Content-Type", "application/javascript");
        response.end(
          `window.DingDianNative={request(id,endpoint,payload){fetch('/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:payload}).then(response=>response.json()).then(result=>NativeLocation.complete(id,result.error?result:{value:result})).catch(error=>NativeLocation.complete(id,{error:error.message}));}};`,
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
            '<script defer src="/preview-native.js"></script><script defer src="/native-bridge.js">',
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
