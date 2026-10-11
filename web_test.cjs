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
