// Map interaction helpers; coordinate parsing works without an online service.
(function (root) {
  function parseCoordinates(text) {
    let value = text.trim().replace(/^geo:/i, '');
    if ((value.startsWith('(') && value.endsWith(')')) || (value.startsWith('[') && value.endsWith(']'))) value = value.slice(1, -1).trim();
    const number = '([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))';
    const match = value.match(new RegExp('^' + number + '(?:\\s*[,，;；]\\s*|\\s+)' + number + '$'));
    if (!match) return null;
    const latitude = Number(match[1]), longitude = Number(match[2]);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('坐标按「纬度, 经度」填写：纬度 -90～90，经度 -180～180。');
    return { latitude, longitude };
  }

  function smoothWheelZoom(map, reducedMotion) {
    const container = map.getContainer();
    let target = map.getZoom(), anchor, frame = 0, lastTime = 0;
    function cancel() {
      cancelAnimationFrame(frame); frame = 0; lastTime = 0; target = map.getZoom();
    }
    function tick(time) {
      const elapsed = lastTime ? Math.min(time - lastTime, 64) : 16;
      lastTime = time;
      const current = map.getZoom();
      const next = current + (target - current) * (1 - Math.exp(-elapsed / 45));
      const settled = Math.abs(target - next) < 0.002;
      map.setZoomAround(anchor, settled ? target : next, { animate: false });
      if (settled) { frame = 0; lastTime = 0; }
      else frame = requestAnimationFrame(tick);
    }
    function wheel(event) {
      if (event.deltaY === 0) return;
      event.preventDefault();
      if (!frame) { map.stop(); target = map.getZoom(); }
      anchor = map.mouseEventToContainerPoint(event);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
      const pixels = event.deltaY * unit * (event.ctrlKey ? 3 : 1);
      target = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), target - Math.max(-120, Math.min(120, pixels)) / 180));
      if (reducedMotion.matches) { cancel(); map.setZoomAround(anchor, Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() - pixels / 180)), { animate: false }); }
      else if (!frame) frame = requestAnimationFrame(tick);
    }
    container.addEventListener('wheel', wheel, { passive: false });
    container.addEventListener('pointerdown', cancel);
    container.addEventListener('keydown', cancel);
    map.on('dragstart', cancel);
    const visibility = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', visibility);
    map.on('unload', () => {
      cancel(); container.removeEventListener('wheel', wheel); container.removeEventListener('pointerdown', cancel); container.removeEventListener('keydown', cancel); document.removeEventListener('visibilitychange', visibility);
    });
    return cancel;
  }
  const api = { parseCoordinates, smoothWheelZoom };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapTools = api;
})(typeof window !== 'undefined' ? window : globalThis);
