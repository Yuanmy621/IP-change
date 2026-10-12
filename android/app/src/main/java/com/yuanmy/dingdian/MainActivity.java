package com.yuanmy.dingdian;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView web;
    private FrameLayout container;
    private LocationController controller;
    private AppUpdater updater;
    private final PlaceSearch search = new PlaceSearch();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean visible, destroyed;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        controller = ((DingDianApp) getApplication()).controller();
        updater = ((DingDianApp) getApplication()).updater();
        web = new WebView(this); web.setBackgroundColor(Color.rgb(20, 20, 22));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false);
        web.addJavascriptInterface(new Bridge(), "DingDianNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!HOST.equals(url.getHost()) || !"https".equals(url.getScheme())) {
                    if ("https".equals(url.getScheme()) && "tile.openstreetmap.org".equals(url.getHost())) return null;
                    return response(403, "Forbidden", "text/plain", new ByteArrayInputStream(new byte[0]));
                }
                String path = url.getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                if (!"GET".equals(request.getMethod()) || path.contains("..")) return response(403, "Forbidden", "text/plain", new ByteArrayInputStream(new byte[0]));
                try {
                    String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".svg") ? "image/svg+xml" : path.endsWith(".png") ? "image/png" : "application/octet-stream";
                    return response(200, "OK", mime, getAssets().open(path.substring(1)));
                } catch (Exception e) { return response(404, "Not Found", "text/plain", new ByteArrayInputStream(new byte[0])); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("https".equals(url.getScheme()) && HOST.equals(url.getHost()) && "/".equals(url.getPath())) return false;
                if ("https".equals(url.getScheme())) try { startActivity(new Intent(Intent.ACTION_VIEW, url)); } catch (Exception ignored) {}
                return true;
            }
        });
        container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(20, 20, 22));
        container.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 30) container.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return insets;
        });
        setContentView(container);
        container.requestApplyInsets();
        if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null)
            getWindow().getInsetsController().setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        web.loadUrl("https://" + HOST + "/");
        requestSetupPermissions();
    }
    private WebResourceResponse response(int code, String reason, String mime, java.io.InputStream body) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'");
        headers.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse(mime, "UTF-8", code, reason, headers, body);
    }
    private void requestSetupPermissions() {
        java.util.ArrayList<String> permissions = new java.util.ArrayList<>();
        if (!controller.hasLocationPermission()) { permissions.add(Manifest.permission.ACCESS_FINE_LOCATION); permissions.add(Manifest.permission.ACCESS_COARSE_LOCATION); }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!permissions.isEmpty()) requestPermissions(permissions.toArray(new String[0]), 10);
    }
    @Override protected void onResume() { super.onResume(); visible = true; }
    @Override protected void onPause() { visible = false; super.onPause(); }
    private void ui(Runnable action) throws Exception {
        AtomicReference<Exception> failure = new AtomicReference<>(); CountDownLatch finished = new CountDownLatch(1);
        runOnUiThread(() -> { try { if (destroyed) throw new IllegalStateException("控制页已关闭，请重新打开。"); action.run(); } catch (Exception e) { failure.set(e); } finally { finished.countDown(); } });
        if (!finished.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("页面响应超时，请重新打开。");
        if (failure.get() != null) throw failure.get();
    }
    private Object dispatch(String path, JSONObject data) throws Exception {
        JSONObject ok = new JSONObject().put("ok", true);
        switch (path) {
            case "appearance/theme":
                final boolean dark = data.optBoolean("dark", true);
                ui(() -> {
                    int background = dark ? Color.rgb(20, 20, 22) : Color.rgb(247, 247, 248);
                    web.setBackgroundColor(background); container.setBackgroundColor(background);
                    if (Build.VERSION.SDK_INT < 35) {
                        getWindow().setStatusBarColor(background);
                        getWindow().setNavigationBarColor(background);
                    }
                    if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
                        int flags = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                        getWindow().getInsetsController().setSystemBarsAppearance(dark ? 0 : flags, flags);
                    } else if (Build.VERSION.SDK_INT < 30) {
                        int flags = android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                        int current = getWindow().getDecorView().getSystemUiVisibility();
                        getWindow().getDecorView().setSystemUiVisibility(dark ? current & ~flags : current | flags);
                    }
                }); return ok;
            case "status": return controller.status();
            case "updates/status": return updater.status();
            case "updates/check": updater.check(); return updater.status();
            case "updates/download":
                if (!visible) throw new IllegalStateException("请在定点页面中点击下载更新。");
                updater.download(); return updater.status();
            case "updates/install":
                ui(() -> {
                    if (!visible) throw new IllegalStateException("请返回定点页面安装更新。");
                    if (controller.pending()) throw new IllegalStateException("请先恢复真实定位，再安装更新。");
                    updater.install(this);
                }); return updater.status();
            case "probe": return new JSONObject().put("model", Build.MODEL).put("android", Build.VERSION.RELEASE).put("hyperos", "手机独立版").put("interface", controller.setup());
            case "settings/mock":
                ui(() -> { requestSetupPermissions(); startActivity(new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)); }); return ok;
            case "places/search": return search.search(data.getString("query"));
            case "location/set":
                if (!visible) throw new IllegalStateException("请在定点页面中点击应用位置。");
                controller.apply(data.getDouble("latitude"), data.getDouble("longitude"), data.optBoolean("network", false));
                try { ui(() -> { if (!visible) throw new IllegalStateException("请返回定点页面重试。"); startForegroundService(new Intent(this, MockLocationService.class)); }); }
                catch (Exception failure) { controller.restore(); throw failure; }
                return ok;
            case "location/reset": case "shutdown":
                controller.restore();
                ui(() -> { stopService(new Intent(this, MockLocationService.class)); if (path.equals("shutdown")) web.postDelayed(this::finish, 350); });
                return ok;
            default: throw new IllegalArgumentException("不支持的手机端操作。");
        }
    }
    private final class Bridge {
        @JavascriptInterface public void request(String id, String path, String payload) {
            if (destroyed || id == null || !id.matches("[0-9]{1,10}") || payload == null || payload.length() > 16384) return;
            worker.execute(() -> {
                JSONObject reply = new JSONObject();
                try { reply.put("value", dispatch(path, new JSONObject(payload))); }
                catch (Exception e) { try { reply.put("error", e.getMessage() == null ? "操作失败，请检查权限并重试。" : e.getMessage()); } catch (Exception ignored) {} }
                String script = "window.NativeLocation&&NativeLocation.complete(" + JSONObject.quote(id) + "," + reply + ")";
                runOnUiThread(() -> { if (!destroyed) web.evaluateJavascript(script, null); });
            });
        }
    }
    @Override protected void onDestroy() {
        destroyed = true; worker.shutdown(); web.removeJavascriptInterface("DingDianNative"); web.destroy(); super.onDestroy();
    }
}
