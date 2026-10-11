const $ = id => document.getElementById(id);
let token = location.hash.slice(1);
if (token) { sessionStorage.setItem('locationToken', token); history.replaceState(null, '', '/'); }
else token = sessionStorage.getItem('locationToken') || '';
let busy = false, stopped = false, status = null, map = null, marker = null, previousError = '', lastDevice = '', initialized = false;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let cancelMapZoom = () => {}, searchBusy = false;
function notify(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); $('message').hidden = false; }
async function api(path, data) {
  const response = await fetch('/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'X-Session-Token': token, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
function validCoordinate() {
  const lat = $('latitude').value, lon = $('longitude').value;
  return lat.trim() !== '' && lon.trim() !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && Number(lat) >= -90 && Number(lat) <= 90 && Number(lon) >= -180 && Number(lon) <= 180;
}
function buttons() {
  const connected = status?.devices?.some(d => d.serial === $('device').value && d.state === 'device');
  const pending = status?.session && !status?.active;
  $('apply').disabled = busy || stopped || !connected || !!pending || !validCoordinate();
  $('probe').disabled = busy || stopped || !connected;
  $('reset').disabled = busy || stopped || !status?.session;
  $('shutdown').disabled = busy || stopped;
  $('device').disabled = busy || stopped || !!status?.session;
  $('network').disabled = busy || stopped || !!status?.session;
  $('apply').firstElementChild.textContent = status?.active ? '更新目标位置' : '应用位置';
}
async function poll() {
  if (stopped || busy) return;
  try {
    status = await api('status');
    if (!initialized) { if (status.session) choose(status.session.latitude, status.session.longitude); initialized = true; }
    const list = status.devices || [], selected = status.session?.serial || $('device').value;
    $('device').replaceChildren();
    if (!list.length) $('device').add(new Option('未发现手机', ''));
    for (const d of list) { const state = { device: '已连接', unauthorized: '等待授权', offline: '离线' }[d.state] || d.state; $('device').add(new Option((d.model || d.serial) + ' · ' + state, d.serial)); }
    if (selected && list.some(d => d.serial === selected)) $('device').value = selected;
    else if (status.session) { $('device').add(new Option(status.session.serial + ' · 未连接（待恢复）', status.session.serial)); $('device').value = status.session.serial; }
    else { const ready = list.find(d => d.state === 'device'); if (ready) $('device').value = ready.serial; }
    const connected = list.some(d => d.serial === $('device').value && d.state === 'device');
    $('connectionState').textContent = connected ? '已连接' : list.some(d => d.state === 'unauthorized') ? '等待授权' : '未连接';
    $('connectionState').classList.toggle('ready', connected);
    if (!connected) { $('deviceInfo').textContent = status.device_error || (list.some(d => d.state === 'unauthorized') ? '请解锁手机，在弹出的提示中允许 USB 调试。' : '请用数据线连接手机，开启 USB 调试，并在手机上允许此电脑。'); lastDevice = ''; }
    else if (lastDevice !== $('device').value) { $('deviceInfo').textContent = '连接已就绪。点击检查兼容性，或直接应用目标坐标。'; lastDevice = $('device').value; }
    $('liveState').classList.toggle('active', status.active);
    $('liveState').lastElementChild.textContent = status.active ? '持续提交坐标 · 最近 ' + new Date(status.last_refresh).toLocaleTimeString() : status.session ? '已暂停 · 需要恢复原手机定位' : '尚未启用模拟定位';
    if (status.session) $('network').checked = status.session.providers.includes('network');
    const error = status.error || status.device_error || '';
    if (error && error !== previousError) notify(error, true);
    previousError = error;
    buttons();
  } catch (error) {
    notify(error.message === 'Failed to fetch' ? '与本地工具的连接已中断。请重新启动工具；如果手机尚未恢复，重新连接后点击恢复真实定位。' : error.message, true);
    status = null; $('connectionState').textContent = '连接中断'; $('connectionState').classList.remove('ready'); buttons();
  }
}
async function action(fn) {
  if (busy || stopped) return;
  busy = true; buttons();
  try { await fn(); } catch (error) { notify(error.message, true); }
  finally { busy = false; if (!stopped) await poll(); buttons(); }
}
function syncMap(pan = false) {
  if (!validCoordinate()) { buttons(); return; }
  const lat = Number($('latitude').value), lon = Number($('longitude').value);
  $('mapCoordinate').textContent = lat.toFixed(6) + ', ' + lon.toFixed(6);
  if (map) {
    const point = [lat, lon];
    if (!marker) marker = L.marker(point, { icon: L.divIcon({ className: '', html: '<div class="map-pin"></div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(map);
    else marker.setLatLng(point);
    if (pan) { cancelMapZoom(); map.stop(); map.flyTo(point, Math.max(map.getZoom(), 12), { animate: !reducedMotion.matches, duration: 0.7 }); }
  }
  buttons();
}
function choose(lat, lon, pan = true) { $('latitude').value = Number(lat).toFixed(6); $('longitude').value = Number(lon).toFixed(6); syncMap(pan); }
if (window.L) {
  map = L.map('map', { zoomControl: true, scrollWheelZoom: false, zoomSnap: 0, zoomDelta: 0.5, minZoom: 2, maxZoom: 19, zoomAnimation: !reducedMotion.matches, fadeAnimation: !reducedMotion.matches }).setView([31.2304, 121.4737], 12);
  cancelMapZoom = MapTools.smoothWheelZoom(map, reducedMotion);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, updateWhenZooming: false, keepBuffer: 2, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' }).addTo(map).on('tileerror', () => { $('mapHint').textContent = '地图加载受网络影响；可直接输入经纬度'; });
  map.on('click', e => choose(e.latlng.lat, e.latlng.wrap().lng, false));
  if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($('map'));
} else $('mapHint').textContent = '地图组件未加载；请直接输入经纬度';
syncMap();
function searchStatus(text, error = false) { $('searchStatus').textContent = text; $('searchStatus').classList.toggle('error', error); }
$('searchForm').addEventListener('submit', async event => {
  event.preventDefault(); if (searchBusy) return;
  const query = $('searchQuery').value.trim();
  $('searchResults').hidden = true; $('searchResults').replaceChildren();
  if (!query) { searchStatus('请输入地名、地址或「纬度, 经度」。', true); $('searchQuery').focus(); return; }
  try {
    const coordinate = MapTools.parseCoordinates(query);
    if (coordinate) { choose(coordinate.latitude, coordinate.longitude); searchStatus('已选定该坐标。连接手机后点击「应用位置」即可使用。'); return; }
    searchBusy = true; $('searchButton').disabled = true; $('searchButton').textContent = '搜索中…'; searchStatus('正在查找位置…');
    const results = await api('places/search', { query });
    if ($('searchQuery').value.trim() !== query) { searchStatus('内容已更新，请按回车重新搜索。'); return; }
    if (!results.length) { searchStatus('没有找到该位置，可补充城市名称或直接输入经纬度。'); return; }
    for (const place of results) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'search-result';
      const title = document.createElement('span'); title.textContent = place.name;
      const coordinateText = document.createElement('small'); coordinateText.textContent = `${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)} · WGS84`;
      button.append(title, coordinateText);
      button.addEventListener('click', () => { choose(place.latitude, place.longitude); $('searchResults').hidden = true; searchStatus('已选定：' + place.name); $('searchQuery').value = place.name.slice(0, 200); });
      $('searchResults').append(button);
    }
    $('searchResults').hidden = false; searchStatus(`找到 ${results.length} 个位置，点击结果选定坐标。`);
  } catch (error) { searchStatus(error.message, true); }
  finally { searchBusy = false; $('searchButton').disabled = false; $('searchButton').textContent = '搜索 ↗'; }
});
for (const id of ['latitude', 'longitude']) $(id).addEventListener('input', () => syncMap());
$('centerMap').addEventListener('click', () => syncMap(true));
document.querySelectorAll('[data-lat]').forEach(b => b.addEventListener('click', () => choose(b.dataset.lat, b.dataset.lon)));
$('device').addEventListener('change', () => { $('deviceInfo').textContent = '设备已切换，请重新检查兼容性。'; buttons(); });
$('probe').addEventListener('click', () => action(async () => {
  const info = await api('probe', { serial: $('device').value });
  $('deviceInfo').textContent = [info.model, 'Android ' + info.android, info.hyperos].filter(Boolean).join(' · ');
  notify(info.interface);
}));
$('locationForm').addEventListener('submit', e => {
  e.preventDefault(); if (!validCoordinate()) { notify('请输入有效的纬度和经度。', true); return; }
  action(async () => { await api('location/set', { serial: $('device').value, latitude: Number($('latitude').value), longitude: Number($('longitude').value), network: $('network').checked }); notify('模拟坐标已提交，并开始持续刷新。请在手机上的目标 App 中检查实际定位。'); });
});
$('reset').addEventListener('click', () => action(async () => { await api('location/reset', {}); notify('本工具的模拟定位源已移除，原有权限已恢复。手机重新获取真实位置可能需要一点时间。'); }));
$('shutdown').addEventListener('click', () => action(async () => { await api('shutdown', {}); stopped = true; status = null; $('connectionState').textContent = '已退出'; $('liveState').classList.remove('active'); $('liveState').lastElementChild.textContent = '工具已退出'; notify('模拟定位已清理，工具已退出。现在可以关闭此网页。'); }));
let favorites = [];
try { const stored = JSON.parse(localStorage.getItem('locationFavorites') || '[]'); if (Array.isArray(stored)) favorites = stored.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180).slice(0, 8); } catch (_) {}
function renderFavorites() { $('savedPlaces').replaceChildren(); favorites.forEach(p => { const b = document.createElement('button'); b.type = 'button'; b.textContent = p.lat.toFixed(3) + ', ' + p.lon.toFixed(3); b.title = '点击使用；按住 Option 点击删除'; b.addEventListener('click', e => { if (e.altKey) { favorites = favorites.filter(f => f !== p); persistFavorites(); renderFavorites(); } else choose(p.lat, p.lon); }); $('savedPlaces').append(b); }); }
function persistFavorites() { try { localStorage.setItem('locationFavorites', JSON.stringify(favorites)); } catch (_) { notify('浏览器未允许保存收藏，此次收藏仅在当前页面保留。', true); } }
$('savePlace').addEventListener('click', () => { if (!validCoordinate()) return; const p = { lat: Number($('latitude').value), lon: Number($('longitude').value) }; favorites = [p, ...favorites.filter(f => f.lat !== p.lat || f.lon !== p.lon)].slice(0, 8); persistFavorites(); renderFavorites(); });
renderFavorites(); poll(); setInterval(poll, 4000);
