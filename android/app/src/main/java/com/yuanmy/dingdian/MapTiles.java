package com.yuanmy.dingdian;

import android.content.Context;
import android.net.http.HttpResponseCache;
import android.webkit.WebResourceResponse;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.net.URL;
import java.util.Collections;
import javax.net.ssl.SSLException;

/** Fetches only requested viewport tiles; honours the provider's HTTP cache headers. */
final class MapTiles {
    private final String userAgent;
    private volatile String lastError = "";
    MapTiles(Context context) {
        String version = "unknown";
        try { version = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName; }
        catch (Exception ignored) {}
        userAgent = "DingDian-Android/" + version + " (+https://github.com/Yuanmy621/IP-change)";
        try {
            if (HttpResponseCache.getInstalled() == null)
                HttpResponseCache.install(new File(context.getCacheDir(), "http-tiles"), 32L * 1024 * 1024);
        } catch (IOException ignored) { /* A full cache must not prevent map loading. */ }
    }
    static String tilePath(String path) {
        if (path == null || !path.matches("/map-tiles/(?:(?:amap|osm)/)?[0-9]{1,2}/[0-9]{1,6}/[0-9]{1,6}\\.png"))
            throw new IllegalArgumentException("Invalid tile path");
        String tail = path.substring(11, path.length() - 4).replaceFirst("^(amap|osm)/", "");
        String[] parts = tail.split("/");
        int z = Integer.parseInt(parts[0]), x = Integer.parseInt(parts[1]), y = Integer.parseInt(parts[2]);
        if (z > 19 || x >= (1 << z) || y >= (1 << z)) throw new IllegalArgumentException("Invalid tile coordinates");
        return z + "/" + x + "/" + y + ".png";
    }
    static String tileURL(String path) {
        String tile = tilePath(path);
        if (!path.startsWith("/map-tiles/amap/")) return "https://tile.openstreetmap.org/" + tile;
        String[] parts = tile.substring(0, tile.length() - 4).split("/");
        return "https://webst02.is.autonavi.com/appmaptile?style=7&x=" + parts[1] + "&y=" + parts[2] + "&z=" + parts[0];
    }
    static byte[] readTile(InputStream input, String mime, String blocked) throws IOException {
        if (blocked != null || mime == null || !mime.split(";", 2)[0].trim().equalsIgnoreCase("image/png"))
            throw new IOException("地图服务未返回可用底图。");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192]; int n;
        while ((n = input.read(buffer)) != -1) {
            if (out.size() + n > 512 * 1024) throw new IOException("底图响应过大。");
            out.write(buffer, 0, n);
        }
        byte[] bytes = out.toByteArray();
        byte[] signature = {(byte)137, 80, 78, 71, 13, 10, 26, 10};
        if (bytes.length < 8) throw new IOException("底图响应不完整。");
        for (int i = 0; i < 8; i++) if (bytes[i] != signature[i]) throw new IOException("底图格式无效。");
        return bytes;
    }
    WebResourceResponse load(String path) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(tileURL(path)).openConnection();
            connection.setConnectTimeout(8000); connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", userAgent);
            connection.setRequestProperty("Accept", "image/png");
            int code = connection.getResponseCode();
            if (code != 200) throw new IOException(code == 403 || code == 429 ? "地图服务暂时拒绝请求，请稍后重试。" : "地图服务响应异常（" + code + "）。");
            byte[] bytes;
            try (InputStream input = connection.getInputStream()) {
                bytes = readTile(input, connection.getContentType(), connection.getHeaderField("X-Blocked"));
            }
            return new WebResourceResponse("image/png", null, 200, "OK", Collections.emptyMap(), new ByteArrayInputStream(bytes));
        } catch (Exception e) {
            if (e instanceof UnknownHostException) lastError = "无法解析地图服务地址，请检查手机网络或私人 DNS。";
            else if (e instanceof SocketTimeoutException) lastError = "地图服务连接超时，请切换 Wi-Fi 或移动网络后重试。";
            else if (e instanceof SSLException) lastError = "地图安全连接失败，请检查手机时间和网络。";
            else lastError = e instanceof IllegalArgumentException ? "底图请求无效。" : e.getMessage() == null ? "地图加载失败，请检查网络后重试。" : e.getMessage();
            return new WebResourceResponse("text/plain", "UTF-8", 502, "Bad Gateway", Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(new byte[0]));
        } finally { if (connection != null) connection.disconnect(); }
    }
    JSONObject status() throws Exception { return new JSONObject().put("error", lastError); }
    void flush() {
        HttpResponseCache cache = HttpResponseCache.getInstalled();
        if (cache != null) cache.flush();
    }
}
