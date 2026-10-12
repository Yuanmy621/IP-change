const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPlaceSearch } = require("./preview-search.cjs");
const feature = (name, coordinates, type = "Point") => ({
  properties: { name },
  geometry: { type, coordinates },
});

test("queries the entered city, maps GeoJSON longitude/latitude and caches results", async () => {
  const queries = [];
  const search = createPlaceSearch({
    minInterval: 0,
    fetchImpl: async (url) => {
      queries.push(url.searchParams.get("q"));
      return {
        ok: true,
        json: async () => ({
          features: [feature(queries.at(-1), [116.391263, 39.907359])],
        }),
      };
    },
  });
  const beijing = await search("北京天安门");
  assert.deepEqual(beijing, [
    { name: "北京 天安门", latitude: 39.907359, longitude: 116.391263 },
  ]);
  assert.deepEqual(await search("北京天安门"), beijing);
  await search("杭州 西湖");
  assert.deepEqual(queries, ["北京 天安门", "杭州 西湖"]);
});

test("filters invalid geometries and duplicate results rather than fabricating a fallback", async () => {
  const search = createPlaceSearch({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        features: [
          null,
          feature("invalid", [999, 40]),
          feature("line", [110, 30], "LineString"),
          feature("West Lake", [120, 30]),
          feature("West Lake", [120, 30]),
        ],
      }),
    }),
  });
  assert.deepEqual(await search("West Lake"), [
    { name: "West Lake", latitude: 30, longitude: 120 },
  ]);
});

test("rejects missing queries and reports upstream failures without Shanghai fixtures", async () => {
  let requests = 0;
  const search = createPlaceSearch({
    fetchImpl: async () => {
      requests++;
      throw new Error("network unavailable");
    },
  });
  await assert.rejects(search(undefined), /1～200/);
  assert.equal(requests, 0);
  await assert.rejects(search("北京"), /暂时无法连接/);
  await assert.rejects(search("杭州"), /搜索过于频繁/);
});
