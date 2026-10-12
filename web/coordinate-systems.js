// Local WGS84/GCJ02 conversion. Map display changes; controller inputs stay WGS84.
(function (root) {
  const pi = Math.PI, a = 6378245, ee = 0.006693421622965943;
  function outside(lat, lon) { return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271; }
  function toGCJ(latitude, longitude) {
    if (outside(latitude, longitude)) return {latitude, longitude};
    const x = longitude - 105, y = latitude - 35;
    let lat = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
    let lon = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
    const wave = (20*Math.sin(6*x*pi) + 20*Math.sin(2*x*pi))*2/3;
    lat += wave + (20*Math.sin(y*pi) + 40*Math.sin(y/3*pi))*2/3 + (160*Math.sin(y/12*pi) + 320*Math.sin(y*pi/30))*2/3;
    lon += wave + (20*Math.sin(x*pi) + 40*Math.sin(x/3*pi))*2/3 + (150*Math.sin(x/12*pi) + 300*Math.sin(x/30*pi))*2/3;
    const rad = latitude/180*pi, magic = 1 - ee*Math.sin(rad)**2, sqrt = Math.sqrt(magic);
    return {latitude: latitude + lat*180/((a*(1-ee))/(magic*sqrt)*pi), longitude: longitude + lon*180/(a/sqrt*Math.cos(rad)*pi)};
  }
  function toWGS(latitude, longitude) {
    if (outside(latitude, longitude)) return {latitude, longitude};
    let result = {latitude, longitude};
    for (let i = 0; i < 8; i++) {
      const shifted = toGCJ(result.latitude, result.longitude);
      const dy = shifted.latitude-latitude, dx = shifted.longitude-longitude;
      result = {latitude: result.latitude-dy, longitude: result.longitude-dx};
      if (Math.max(Math.abs(dy),Math.abs(dx)) < 1e-8) break;
    }
    return result;
  }
  const api = {toGCJ, toWGS};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CoordinateSystems = api;
})(typeof window === 'object' ? window : globalThis);
