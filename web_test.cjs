const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCoordinates } = require('./web/map-tools.js');

test('coordinates copied with different separators and brackets', () => {
  for (const text of ['31.2304, 121.4737', '31.2304，121.4737', '31.2304 121.4737', '(31.2304,121.4737)', '[31.2304;121.4737]', 'geo:31.2304,121.4737']) {
    assert.deepEqual(parseCoordinates(text), { latitude: 31.2304, longitude: 121.4737 });
  }
  assert.deepEqual(parseCoordinates(' -33.8688, +151.2093 '), { latitude: -33.8688, longitude: 151.2093 });
  assert.deepEqual(parseCoordinates('0, 0'), { latitude: 0, longitude: 0 });
});
test('out-of-range coordinates produce a local validation error', () => {
  for (const text of ['91, 0', '0, -181', '121.4737, 31.2304']) assert.throws(() => parseCoordinates(text), /纬度/);
});
test('addresses and incomplete numbers are never mistaken for coordinates', () => {
  for (const text of ['上海人民广场', '上海市31号121号', '31.23', '31.23,', '31, 121 extra', '31,121,0', '']) assert.equal(parseCoordinates(text), null);
});

const { watchTiles } = require('./web/map-loading.js');
function tileFixture() {
  const handlers = {}, timers = new Map(); let next = 0, state;
  const layer = { on(name, fn) { handlers[name] = fn; }, redraw() { for (const tile of tiles) { handlers.tileunload({tile}); handlers.tileloadstart({tile}); } } };
  const tiles = [{}, {}];
  const clock = { setTimeout(fn) { timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); } };
  const monitor = watchTiles(layer, value => state = value, clock);
  return { tiles, monitor, emit: (name, tile) => handlers[name]({tile}), state: () => state, expire() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); }, timers };
}
test('tile failures stay visible with partial success; retry recovers', () => {
  const f = tileFixture(), [a,b] = f.tiles;
  f.emit('tileloadstart',a); f.emit('tileloadstart',b);
  f.emit('tileerror',a); f.emit('tileload',b);
  assert.equal(f.state(),'error'); assert.equal(f.timers.size,0);
  f.monitor.retry(); assert.equal(f.state(),'loading');
  f.emit('tileload',a); f.emit('tileload',b);
  assert.equal(f.state(),'ready'); assert.equal(f.timers.size,0);
});
test('stalled loads show an error and late responses can recover', () => {
  const f = tileFixture(), [a] = f.tiles;
  f.emit('tileloadstart',a); f.expire(); assert.equal(f.state(),'error');
  f.emit('tileload',a); assert.equal(f.state(),'ready');
});
test('removed tiles and late stale responses cannot overwrite current viewport', () => {
  const f = tileFixture(), [a,b] = f.tiles;
  f.emit('tileloadstart',a); f.emit('tileerror',a);
  f.emit('tileunload',a); f.emit('tileloadstart',b); f.emit('tileload',b);
  f.emit('tileerror',a); assert.equal(f.state(),'ready'); assert.equal(f.timers.size,0);
});

const { toGCJ, toWGS } = require('./web/coordinate-systems.js');
test('AMap display uses GCJ02 while selected and submitted coordinates remain WGS84', () => {
  const shifted = toGCJ(39.9042,116.4074);
  assert.ok(Math.abs(shifted.latitude-39.90560334316507)<1e-8);
  assert.ok(Math.abs(shifted.longitude-116.41364225378803)<1e-8);
  const original = toWGS(39.90560334316507,116.41364225378803);
  assert.ok(Math.abs(original.latitude-39.9042)<1e-7);
  assert.ok(Math.abs(original.longitude-116.4074)<1e-7);
  for (const point of [[31.2304,121.4737],[23.1291,113.2644],[30.5728,104.0668]]) {
    const display = toGCJ(...point), restored = toWGS(display.latitude,display.longitude);
    assert.ok(Math.abs(restored.latitude-point[0])<1e-7);
    assert.ok(Math.abs(restored.longitude-point[1])<1e-7);
  }
});
test('map conversion leaves out-of-area coordinates unchanged', () => {
  for (const point of [[51.5074,-0.1278],[-33.8688,151.2093],[0,0]]) {
    assert.deepEqual(toGCJ(...point),{latitude:point[0],longitude:point[1]});
    assert.deepEqual(toWGS(...point),{latitude:point[0],longitude:point[1]});
  }
});
test('aborted requests from zoom changes do not leave a false timeout over a loaded map', () => {
  const f = tileFixture(), [old,current] = f.tiles;
  f.emit('tileloadstart',old); f.emit('tileloadstart',current);
  f.emit('tileabort',old); f.emit('tileload',current);
  f.expire(); assert.equal(f.state(),'ready'); assert.equal(f.timers.size,0);
  f.emit('tileerror',old); assert.equal(f.state(),'ready');
});
