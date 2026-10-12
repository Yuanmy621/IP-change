(function (root) {
  // Track actual tiles, including viewport changes and tiles removed mid-request.
  function watchTiles(layer, report, clock = globalThis, timeout = 18000) {
    const tiles = new Map();
    let timer = null, expired = false;
    function render() {
      const states = [...tiles.values()];
      const pending = states.includes('loading');
      const failed = states.includes('error') || (pending && expired);
      if (timer !== null && !pending) { clock.clearTimeout(timer); timer = null; expired = false; }
      if (pending && timer === null && !expired) timer = clock.setTimeout(() => { timer = null; expired = true; render(); }, timeout);
      report(failed ? 'error' : pending && !states.includes('ready') ? 'loading' : 'ready');
    }
    layer.on('tileloadstart', ({tile}) => { tiles.set(tile, 'loading'); render(); });
    layer.on('tileload', ({tile}) => { if (tiles.has(tile)) { tiles.set(tile, 'ready'); render(); } });
    layer.on('tileerror', ({tile}) => { if (tiles.has(tile)) { tiles.set(tile, 'error'); render(); } });
    const remove = ({tile}) => { tiles.delete(tile); render(); };
    layer.on('tileunload', remove);
    layer.on('tileabort', remove);
    return {
      retry() {
        if (timer !== null) clock.clearTimeout(timer);
        timer = null; expired = false; tiles.clear();
        layer.redraw(); render();
      },
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = { watchTiles };
  else root.MapLoading = { watchTiles };
})(typeof window === 'object' ? window : globalThis);
