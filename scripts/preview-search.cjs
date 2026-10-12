// The preview uses the same public Photon service and result shape as the app.
function createPlaceSearch({ fetchImpl = fetch, minInterval = 1000 } = {}) {
  const cache = new Map();
  let lastRequest = 0;
  return async function search(value) {
    let query =
      typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    if (!query || Array.from(query).length > 200)
      throw new Error("请输入 1～200 字的地名或地址。");
    if (!query.includes(" "))
      query = query.replace(/^(北京|上海|天津|重庆)(市)?([^\s].*)$/, "$1$2 $3");
    const now = Date.now();
    const saved = cache.get(query);
    if (saved && saved.expires > now) return saved.places;
    if (now - lastRequest < minInterval)
      throw new Error("搜索过于频繁，请稍等一秒再试。");
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "5");
    lastRequest = now;
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "DingDian-UI-Preview/1.0",
        },
        signal: AbortSignal.timeout(10000),
      });
    } catch (_) {
      throw new Error(
        "地名搜索服务暂时无法连接。请检查网络，或直接输入经纬度。",
      );
    }
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "地名搜索服务请求过多，请稍后重试。"
          : `地名搜索服务暂不可用（${response.status}），可直接输入经纬度。`,
      );
    let payload;
    try {
      payload = await response.json();
    } catch (_) {
      throw new Error("地名查询服务返回的数据无法读取，请稍后重试。");
    }
    if (!Array.isArray(payload?.features))
      throw new Error("地名查询服务返回的数据无法读取，请稍后重试。");
    const places = [],
      seen = new Set();
    for (const feature of payload.features) {
      const point = feature?.geometry?.coordinates;
      if (
        feature?.geometry?.type !== "Point" ||
        !Array.isArray(point) ||
        point.length !== 2 ||
        !point.every(Number.isFinite) ||
        Math.abs(point[0]) > 180 ||
        Math.abs(point[1]) > 90
      )
        continue;
      const parts = [
        "name",
        "street",
        "housenumber",
        "district",
        "city",
        "state",
        "country",
      ]
        .map((key) => feature.properties?.[key])
        .filter((value) => typeof value === "string" && value);
      const name = [...new Set(parts)].join(" · ");
      if (!name) continue;
      const key = `${name}|${point.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      places.push({ name, latitude: point[1], longitude: point[0] });
      if (places.length === 5) break;
    }
    for (const [key, entry] of cache)
      if (entry.expires <= now) cache.delete(key);
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(query, { places, expires: Date.now() + 30 * 60 * 1000 });
    return places;
  };
}
module.exports = { createPlaceSearch };
