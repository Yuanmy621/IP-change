// This adapter is only active inside the installed Android controller.
(function () {
  if (!window.DingDianNative) return;
  let sequence = 0;
  const pending = new Map();
  window.NativeLocation = {
    mapTileTemplate: DingDianNative.preview ? DingDianNative.mapTileTemplate : "/map-tiles/{provider}/{z}/{x}/{y}.png",
    request(path, data) {
      return new Promise((resolve, reject) => {
        const id = String(++sequence);
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error('手机端响应超时，请检查服务状态。')); }, 25000);
        pending.set(id, { resolve, reject, timeout });
        try { DingDianNative.request(id, path, JSON.stringify(data === undefined ? {} : data)); }
        catch (error) { clearTimeout(timeout); pending.delete(id); reject(error); }
      });
    },
    complete(id, result) {
      const item = pending.get(id); if (!item) return;
      clearTimeout(item.timeout); pending.delete(id);
      if (result.error) item.reject(new Error(result.error));
      else item.resolve(result.value);
    }
  };
})();
