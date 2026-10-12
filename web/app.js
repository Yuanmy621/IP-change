const $ = (id) => document.getElementById(id);
const onPhone = !!window.NativeLocation;
if (onPhone) {
  document.body.classList.add("on-phone");
  $("runtimeMode").textContent = "手机独立版";
  $("runtimeLabel").textContent = "本机运行";
  $("deviceHeading").textContent = "手机授权";
  document.querySelector("label[for=device]").textContent = "当前设备";
  $("probe").lastElementChild.textContent = "检查授权状态";
  document.title = "定点 · 手机定位工具";
  $("mockSettings").hidden = false;
  $("mockSettings").addEventListener("click", () =>
    NativeLocation.request("settings/mock").catch((error) =>
      notify(error.message, true),
    ),
  );
  $("footerMode").textContent = "Android / 本机";
  $("settingsMode").textContent = "手机独立版";
  $("settingsRuntime").textContent =
    "前台服务在这台手机持续刷新坐标。日常使用无需电脑，结束后从页面或通知栏恢复。";
  $("connectionReminder").textContent = "也可以从通知栏恢复定位。";
  $("setupHelp").textContent =
    "允许精确定位和通知，并开启手机定位。在开发者选项中将「定点」选为模拟位置信息应用。完成后可直接在手机操作。";
  $("restoreHelp").textContent =
    "手机前台服务每 2 秒刷新坐标。结束后从页面或通知栏恢复真实定位。进程被终止后，重新打开先处理待恢复会话。";
}
let token = location.hash.slice(1);
if (token) {
  sessionStorage.setItem("locationToken", token);
  history.replaceState(null, "", "/");
} else token = sessionStorage.getItem("locationToken") || "";
let busy = false,
  stopped = false,
  status = null,
  map = null,
  marker = null,
  previousError = "",
  lastDevice = "",
  initialized = false;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let cancelMapZoom = () => {},
  searchBusy = false;
function notify(text, error = false) {
  $("messageText").textContent = text;
  $("message").classList.toggle("error", error);
  $("message").hidden = false;
}
async function api(path, data) {
  if (onPhone) return NativeLocation.request(path, data);
  const response = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: { "X-Session-Token": token, "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "请求失败");
  return result;
}
function validCoordinate() {
  const lat = $("latitude").value,
    lon = $("longitude").value;
  return (
    lat.trim() !== "" &&
    lon.trim() !== "" &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lon)) &&
    Number(lat) >= -90 &&
    Number(lat) <= 90 &&
    Number(lon) >= -180 &&
    Number(lon) <= 180
  );
}
function buttons() {
  const connected = status?.devices?.some(
    (d) => d.serial === $("device").value && d.state === "device",
  );
  const pending = status?.session && !status?.active;
  $("apply").disabled =
    busy ||
    stopped ||
    !connected ||
    !!pending ||
    !validCoordinate() ||
    (onPhone && !status?.ready);
  $("probe").disabled = busy || stopped || !connected;
  $("reset").disabled = busy || stopped || !status?.session;
  $("shutdown").disabled = busy || stopped;
  $("settingsShutdown").disabled = busy || stopped;
  $("device").disabled = onPhone || busy || stopped || !!status?.session;
  $("network").disabled = busy || stopped || !!status?.session;
  $("apply").firstElementChild.textContent = status?.active
    ? "更新目标位置"
    : "应用位置";
}
async function poll() {
  if (stopped || busy) return;
  try {
    status = await api("status");
    if (status.preview) {
      $("runtimeMode").textContent = "界面预览";
      $("runtimeLabel").textContent = "搜索联网 · 模拟设备";
      $("footerMode").textContent = "UI / 预览";
      $("settingsRuntime").textContent =
        "此页面用于界面预览：地名搜索联网查询，设备与定位操作均为模拟，不会修改手机定位。";
    }
    if (!initialized) {
      if (status.session)
        choose(status.session.latitude, status.session.longitude);
      initialized = true;
    }
    const list = status.devices || [],
      selected = status.session?.serial || $("device").value;
    $("device").replaceChildren();
    if (!list.length) $("device").add(new Option("未发现手机", ""));
    for (const d of list) {
      const state =
        { device: "已连接", unauthorized: "等待授权", offline: "离线" }[
          d.state
        ] || d.state;
      $("device").add(
        new Option((d.model || d.serial) + " · " + state, d.serial),
      );
    }
    if (selected && list.some((d) => d.serial === selected))
      $("device").value = selected;
    else if (status.session) {
      $("device").add(
        new Option(
          status.session.serial + " · 未连接（待恢复）",
          status.session.serial,
        ),
      );
      $("device").value = status.session.serial;
    } else {
      const ready = list.find((d) => d.state === "device");
      if (ready) $("device").value = ready.serial;
    }
    const connected = list.some(
      (d) => d.serial === $("device").value && d.state === "device",
    );
    $("connectionState").textContent = connected
      ? onPhone
        ? status.ready
          ? "已授权"
          : "需授权"
        : "已连接"
      : list.some((d) => d.state === "unauthorized")
        ? "等待授权"
        : "未连接";
    $("connectionState").classList.toggle(
      "ready",
      connected && (!onPhone || status.ready),
    );
    if (!connected) {
      $("deviceInfo").textContent =
        status.device_error ||
        (list.some((d) => d.state === "unauthorized")
          ? "请解锁手机，在弹出的提示中允许 USB 调试。"
          : "请用数据线连接手机，开启 USB 调试，并在手机上允许此电脑。");
      lastDevice = "";
    } else if (onPhone || status.preview) {
      $("deviceInfo").textContent =
        status.setup || "手机端已就绪，可直接应用目标坐标。";
    } else if (lastDevice !== $("device").value) {
      $("deviceInfo").textContent =
        "连接已就绪。点击检查兼容性，或直接应用目标坐标。";
      lastDevice = $("device").value;
    }
    $("liveState").classList.toggle("active", status.active);
    $("liveState").lastElementChild.textContent = status.active
      ? "持续提交坐标 · 最近 " +
        new Date(status.last_refresh).toLocaleTimeString()
      : status.session
        ? "已暂停 · 需要恢复原手机定位"
        : "尚未启用模拟定位";
    if (status.session)
      $("network").checked = status.session.providers.includes("network");
    const error = status.error || status.device_error || "";
    if (error && error !== previousError) notify(error, true);
    previousError = error;
    buttons();
  } catch (error) {
    notify(
      error.message === "Failed to fetch"
        ? "与本地工具的连接已中断。请重新启动工具；如果手机尚未恢复，重新连接后点击恢复真实定位。"
        : error.message,
      true,
    );
    status = null;
    $("connectionState").textContent = "连接中断";
    $("connectionState").classList.remove("ready");
    buttons();
  }
}
async function action(fn) {
  if (busy || stopped) return;
  busy = true;
  buttons();
  try {
    await fn();
  } catch (error) {
    notify(error.message, true);
  } finally {
    busy = false;
    if (!stopped) await poll();
    buttons();
  }
}
function syncMap(pan = false) {
  if (!validCoordinate()) {
    buttons();
    return;
  }
  const lat = Number($("latitude").value),
    lon = Number($("longitude").value);
  $("mapCoordinate").textContent = lat.toFixed(6) + ", " + lon.toFixed(6);
  if (map) {
    const point = [lat, lon];
    if (!marker)
      marker = L.marker(point, {
        icon: L.divIcon({
          className: "",
          html: '<div class="map-pin"></div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      }).addTo(map);
    else marker.setLatLng(point);
    if (pan) {
      cancelMapZoom();
      map.stop();
      map.flyTo(point, Math.max(map.getZoom(), 12), {
        animate: !reducedMotion.matches,
        duration: 0.7,
      });
    }
  }
  document
    .querySelectorAll("[data-lat]")
    .forEach((button) =>
      button.classList.toggle(
        "selected",
        Number(button.dataset.lat) === lat &&
          Number(button.dataset.lon) === lon,
      ),
    );
  updateSavedState();
  buttons();
}
function choose(lat, lon, pan = true, name = "自定义位置") {
  $("latitude").value = Number(lat).toFixed(6);
  $("longitude").value = Number(lon).toFixed(6);
  $("targetName").textContent = name;
  syncMap(pan);
}
if (window.L) {
  map = L.map("map", {
    zoomControl: false,
    scrollWheelZoom: false,
    zoomSnap: 0,
    zoomDelta: 0.5,
    minZoom: 2,
    maxZoom: 19,
    zoomAnimation: !reducedMotion.matches,
    fadeAnimation: !reducedMotion.matches,
  }).setView([31.2304, 121.4737], 12);
  cancelMapZoom = MapTools.smoothWheelZoom(map, reducedMotion);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    updateWhenZooming: false,
    keepBuffer: 2,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  })
    .addTo(map)
    .on("tileerror", () => {
      $("mapHint").lastElementChild.textContent =
        "地图加载受网络影响；可直接输入经纬度";
    });
  map.on("click", (e) =>
    choose(e.latlng.lat, e.latlng.wrap().lng, false, "地图选点"),
  );
  if (window.ResizeObserver)
    new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(
      $("map"),
    );
} else
  $("mapHint").lastElementChild.textContent =
    "地图组件未加载；请直接输入经纬度";
function searchStatus(text, error = false) {
  $("searchStatus").textContent = text;
  $("searchStatus").classList.toggle("error", error);
}
$("searchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (searchBusy) return;
  const query = $("searchQuery").value.trim();
  $("searchResults").hidden = true;
  $("searchResults").replaceChildren();
  if (!query) {
    searchStatus("请输入地名、地址或「纬度, 经度」。", true);
    $("searchQuery").focus();
    return;
  }
  try {
    const coordinate = MapTools.parseCoordinates(query);
    if (coordinate) {
      choose(coordinate.latitude, coordinate.longitude, true, "坐标选点");
      searchStatus("已选定坐标。点击「应用位置」开始使用。");
      return;
    }
    searchBusy = true;
    $("searchButton").disabled = true;
    $("searchButton").textContent = "搜索中…";
    searchStatus("正在查找位置…");
    const results = await api("places/search", { query });
    if ($("searchQuery").value.trim() !== query) {
      searchStatus("内容已更新，请按回车重新搜索。");
      return;
    }
    if (!results.length) {
      searchStatus("没有找到该位置，可补充城市名称或直接输入经纬度。");
      return;
    }
    for (const place of results) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      const title = document.createElement("span");
      title.textContent = place.name;
      const coordinateText = document.createElement("small");
      coordinateText.textContent = `${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)} · WGS84`;
      const text = document.createElement("div");
      text.append(title, coordinateText);
      button.append(DingDianUI.icon("MapPin"), text);
      button.addEventListener("click", () => {
        choose(place.latitude, place.longitude, true, place.name);
        $("searchResults").hidden = true;
        searchStatus("已选定：" + place.name);
        $("searchQuery").value = place.name.slice(0, 200);
      });
      $("searchResults").append(button);
    }
    $("searchResults").hidden = false;
    searchStatus(`找到 ${results.length} 个位置，点击结果选定坐标。`);
  } catch (error) {
    searchStatus(error.message, true);
  } finally {
    searchBusy = false;
    $("searchButton").disabled = false;
    $("searchButton").textContent = "搜索";
  }
});
for (const id of ["latitude", "longitude"])
  $(id).addEventListener("input", () => {
    $("targetName").textContent = "自定义位置";
    syncMap();
  });
$("centerMap").addEventListener("click", () => syncMap(true));
document
  .querySelectorAll("[data-lat]")
  .forEach((b) =>
    b.addEventListener("click", () =>
      choose(b.dataset.lat, b.dataset.lon, true, b.dataset.name),
    ),
  );
$("device").addEventListener("change", () => {
  $("deviceInfo").textContent = "设备已切换，请重新检查兼容性。";
  buttons();
});
$("probe").addEventListener("click", () =>
  action(async () => {
    const info = await api("probe", { serial: $("device").value });
    $("deviceInfo").textContent = [
      info.model,
      "Android " + info.android,
      info.hyperos,
    ]
      .filter(Boolean)
      .join(" · ");
    notify(info.interface);
  }),
);
$("locationForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!validCoordinate()) {
    notify("请输入有效的纬度和经度。", true);
    return;
  }
  action(async () => {
    await api("location/set", {
      serial: $("device").value,
      latitude: Number($("latitude").value),
      longitude: Number($("longitude").value),
      network: $("network").checked,
    });
    notify(
      status?.preview
        ? "预览坐标已更新，此页面不会修改手机定位。"
        : "模拟坐标已提交，并开始持续刷新。请在手机上的目标 App 中检查实际定位。",
    );
  });
});
$("reset").addEventListener("click", () =>
  action(async () => {
    await api("location/reset", {});
    notify(
      status?.preview
        ? "预览定位会话已清理。"
        : onPhone
          ? "本工具的模拟定位源已移除。手机重新获取真实位置可能需要一点时间。"
          : "本工具的模拟定位源已移除，原有权限已恢复。手机重新获取真实位置可能需要一点时间。",
    );
  }),
);
$("shutdown").addEventListener("click", () =>
  action(async () => {
    await api("shutdown", {});
    stopped = true;
    status = null;
    $("connectionState").textContent = "已退出";
    $("liveState").classList.remove("active");
    $("liveState").lastElementChild.textContent = "工具已退出";
    notify("模拟定位已清理，工具已退出。现在可以关闭此网页。");
  }),
);
let favorites = [];
try {
  const stored = JSON.parse(localStorage.getItem("locationFavorites") || "[]");
  if (Array.isArray(stored))
    favorites = stored
      .filter(
        (p) =>
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lon) &&
          Math.abs(p.lat) <= 90 &&
          Math.abs(p.lon) <= 180,
      )
      .slice(0, 8)
      .map((p) => ({
        lat: p.lat,
        lon: p.lon,
        name: typeof p.name === "string" ? p.name.slice(0, 120) : "收藏位置",
      }));
} catch (_) {}
function updateSavedState() {
  const saved =
    validCoordinate() &&
    favorites.some(
      (p) =>
        p.lat === Number($("latitude").value) &&
        p.lon === Number($("longitude").value),
    );
  $("savePlace").classList.toggle("is-saved", saved);
  $("savePlace").setAttribute(
    "aria-label",
    saved ? "当前位置已收藏" : "收藏当前位置",
  );
}
function renderFavorites() {
  $("savedPlaces").replaceChildren();
  favorites.forEach((p) => {
    const row = document.createElement("div");
    row.className = "favorite-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "favorite-select";
    const label = document.createElement("span");
    label.textContent = p.name;
    const coordinate = document.createElement("small");
    coordinate.textContent = p.lat.toFixed(5) + ", " + p.lon.toFixed(5);
    label.append(coordinate);
    button.append(DingDianUI.icon("MapPin"), label);
    button.addEventListener("click", () => {
      choose(p.lat, p.lon, true, p.name);
      $("favoritesDrawer").open = false;
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.setAttribute("aria-label", "删除收藏：" + p.name);
    remove.append(DingDianUI.icon("Trash2"));
    remove.addEventListener("click", () => {
      favorites = favorites.filter((f) => f !== p);
      persistFavorites();
      renderFavorites();
    });
    row.append(button, remove);
    $("savedPlaces").append(row);
  });
  $("favoritesEmpty").hidden = !!favorites.length;
  $("favoritesCount").textContent = favorites.length;
  $("drawerCount").textContent = favorites.length + " / 8";
  updateSavedState();
}
function persistFavorites() {
  try {
    localStorage.setItem("locationFavorites", JSON.stringify(favorites));
  } catch (_) {
    notify("浏览器未允许保存收藏，此次收藏仅在当前页面保留。", true);
  }
}
function saveTarget() {
  if (!validCoordinate()) {
    notify("请先输入有效的经纬度。", true);
    return;
  }
  const place = {
    lat: Number($("latitude").value),
    lon: Number($("longitude").value),
    name: $("targetName").textContent.slice(0, 120),
  };
  favorites = [
    place,
    ...favorites.filter((p) => p.lat !== place.lat || p.lon !== place.lon),
  ].slice(0, 8);
  persistFavorites();
  renderFavorites();
  notify("已收藏：" + place.name);
}
$("savePlace").addEventListener("click", saveTarget);
$("saveFromDrawer").addEventListener("click", saveTarget);
$("dismissMessage").addEventListener("click", () => {
  $("message").hidden = true;
});
$("zoomIn").addEventListener("click", () => {
  if (map) {
    cancelMapZoom();
    map.zoomIn(0.5);
  }
});
$("zoomOut").addEventListener("click", () => {
  if (map) {
    cancelMapZoom();
    map.zoomOut(0.5);
  }
});
$("panelToggle").addEventListener("click", () => {
  const expanded = $("locationPanel").classList.toggle("panel-expanded");
  $("panelToggle").setAttribute("aria-expanded", String(expanded));
  $("panelToggle").setAttribute(
    "aria-label",
    expanded ? "收起位置选项" : "展开位置选项",
  );
});
for (const button of document.querySelectorAll("[data-open]"))
  button.addEventListener("click", () => {
    const parent = button.closest("wa-dialog");
    if (parent) parent.open = false;
    $(button.dataset.open).open = true;
  });
$("settingsShutdown").addEventListener("click", () => {
  $("settingsDialog").open = false;
  $("shutdown").click();
});
for (const button of document.querySelectorAll("[data-close]"))
  button.addEventListener("click", () => {
    $(button.dataset.close).open = false;
  });
$("workspaceNav").addEventListener("click", () => $("searchQuery").focus());
const mobileLayout = matchMedia("(max-width: 900px)");
function updateLayout() {
  // Move a single device form, retaining values, state and event listeners.
  $(mobileLayout.matches ? "mobileDeviceSlot" : "desktopDeviceSlot").append(
    $("connectionCard"),
  );
  $("favoritesDrawer").placement = mobileLayout.matches ? "bottom" : "end";
  if (map) requestAnimationFrame(() => map.invalidateSize({ pan: false }));
}
mobileLayout.addEventListener("change", updateLayout);
updateLayout();
let themePreference = "dark";
try {
  const stored = localStorage.getItem("dingdianTheme");
  if (["dark", "light", "system"].includes(stored)) themePreference = stored;
} catch (_) {}
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
function applyTheme(preference, persist = true) {
  themePreference = preference;
  const dark =
    preference === "system" ? systemTheme.matches : preference === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.classList.toggle("wa-dark", dark);
  document.documentElement.classList.toggle("wa-light", !dark);
  $("themeCycle").replaceChildren(DingDianUI.icon(dark ? "Moon" : "Sun"));
  $("themeCycle").setAttribute(
    "aria-label",
    dark ? "切换为浅色主题" : "切换为深色主题",
  );
  document.querySelectorAll("input[name=theme]").forEach((input) => {
    input.checked = input.value === preference;
  });
  if (persist)
    try {
      localStorage.setItem("dingdianTheme", preference);
    } catch (_) {}
  if (onPhone)
    NativeLocation.request("appearance/theme", { dark }).catch(() => {});
}
$("themeCycle").addEventListener("click", () =>
  applyTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  ),
);
document
  .querySelectorAll("input[name=theme]")
  .forEach((input) =>
    input.addEventListener("change", () => applyTheme(input.value)),
  );
systemTheme.addEventListener("change", () => {
  if (themePreference === "system") applyTheme("system", false);
});
applyTheme(themePreference, false);
document.addEventListener("keydown", (event) => {
  if (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "k" &&
    !document.querySelector("wa-dialog[open],wa-drawer[open]")
  ) {
    event.preventDefault();
    $("searchQuery").focus();
    $("searchQuery").select();
  }
  if (event.key === "Escape") $("searchResults").hidden = true;
  if (
    (event.target === $("searchQuery") ||
      $("searchResults").contains(event.target)) &&
    ["ArrowDown", "ArrowUp"].includes(event.key) &&
    !$("searchResults").hidden
  ) {
    const choices = Array.from($("searchResults").querySelectorAll("button"));
    if (!choices.length) return;
    event.preventDefault();
    const index = choices.indexOf(document.activeElement);
    choices[
      (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) %
        choices.length
    ].focus();
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".map-search")) $("searchResults").hidden = true;
});
renderFavorites();
syncMap();
poll();
setInterval(poll, 4000);
