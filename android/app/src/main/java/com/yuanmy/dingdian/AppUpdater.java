package com.yuanmy.dingdian;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Network work is independent of the WebView bridge and never touches location state. */
final class AppUpdater {
    private final Context context;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final PackageInfo installed;
    private UpdateRelease release;
    private String state = "idle", error = "";
    private long downloaded;

    AppUpdater(Context context) {
        this.context = context.getApplicationContext();
        try { installed = context.getPackageManager().getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES); }
        catch (Exception e) { throw new IllegalStateException("无法读取当前版本。", e); }
    }
    static File apk(Context context) { return new File(context.getCacheDir(), "updates/dingdian.apk"); }
    synchronized JSONObject status() throws Exception {
        JSONObject value = new JSONObject().put("state", state).put("currentVersion", installed.versionName)
            .put("currentCode", installed.getLongVersionCode()).put("error", error)
            .put("downloaded", downloaded).put("canInstall", context.getPackageManager().canRequestPackageInstalls());
        if (release != null) value.put("latestVersion", release.version).put("size", release.size)
            .put("notes", release.notes).put("releaseUrl", release.page)
            .put("hasUpdate", release.newerThan(installed.getLongVersionCode()));
        return value;
    }
    private boolean working() { return state.equals("checking") || state.equals("downloading"); }
    synchronized void check() {
        if (working()) return;
        state = "checking"; error = ""; release = null; downloaded = 0;
        worker.execute(() -> {
            try {
                UpdateRelease candidate = new UpdateRelease(new JSONObject(readText(UpdateRelease.MANIFEST)));
                if (candidate.minSdk > Build.VERSION.SDK_INT) throw new IllegalStateException("新版本需要 Android API " + candidate.minSdk + " 或更高版本。");
                synchronized (this) {
                    release = candidate;
                    state = candidate.newerThan(installed.getLongVersionCode()) ? "available" : "current";
                }
            } catch (Exception e) { fail(e); }
        });
    }
    synchronized void download() {
        if (working()) return;
        if (release == null || !release.newerThan(installed.getLongVersionCode())) throw new IllegalStateException("请先检查是否有新版本。");
        if (state.equals("ready") && apk(context).isFile()) return;
        final UpdateRelease candidate = release;
        state = "downloading"; error = ""; downloaded = 0;
        worker.execute(() -> {
            File part = new File(apk(context).getParentFile(), "download.part");
            HttpURLConnection connection = null;
            try {
                if (!part.getParentFile().isDirectory() && !part.getParentFile().mkdirs()) throw new IllegalStateException("无法创建更新目录。");
                // Never expose an old or partial APK while downloading a new one.
                if (apk(context).exists() && !apk(context).delete()) throw new IllegalStateException("无法清理旧更新包。");
                connection = open(candidate.url);
                long length = connection.getContentLengthLong();
                if (length > 0 && length != candidate.size) throw new IllegalStateException("更新包大小与清单不一致。");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long total = 0, deadline = android.os.SystemClock.elapsedRealtime() + 300_000;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(part)) {
                    byte[] buffer = new byte[32768]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > candidate.size || android.os.SystemClock.elapsedRealtime() > deadline) throw new IllegalStateException("更新包过大或下载超时，请重试。");
                        digest.update(buffer, 0, count); output.write(buffer, 0, count);
                        synchronized (this) { downloaded = total; }
                    }
                    output.getFD().sync();
                }
                candidate.verifyDownload(total, hex(digest.digest()));
                verifyPackage(part, candidate);
                if (!part.renameTo(apk(context))) throw new IllegalStateException("无法保存更新包。");
                synchronized (this) { state = "ready"; }
            } catch (Exception e) { part.delete(); fail(e); }
            finally { if (connection != null) connection.disconnect(); }
        });
    }
    synchronized void install(Activity activity) {
        if (!state.equals("ready") || !apk(context).isFile()) throw new IllegalStateException("请先完成更新包下载。");
        if (!context.getPackageManager().canRequestPackageInstalls()) {
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName())));
            return;
        }
        Uri uri = Uri.parse("content://" + context.getPackageName() + ".updates/dingdian.apk");
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        // Android's installer validates the complete APK signature and asks the user to confirm.
        activity.startActivity(intent);
    }
    private void verifyPackage(File file, UpdateRelease candidate) throws Exception {
        PackageInfo incoming = context.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (incoming == null || !installed.packageName.equals(incoming.packageName)
            || incoming.getLongVersionCode() != candidate.code || !candidate.version.equals(incoming.versionName)
            || incoming.getLongVersionCode() <= installed.getLongVersionCode()
            || incoming.applicationInfo == null || incoming.applicationInfo.minSdkVersion != candidate.minSdk
            || incoming.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT)
            throw new IllegalStateException("APK 的包名或版本与更新清单不匹配。");
        Signature[] oldSigners = installed.signingInfo == null ? null : installed.signingInfo.getApkContentsSigners();
        Signature[] newSigners = incoming.signingInfo == null ? null : incoming.signingInfo.getApkContentsSigners();
        if (oldSigners == null || newSigners == null || oldSigners.length != newSigners.length || oldSigners.length == 0)
            throw new IllegalStateException("无法验证更新包签名。");
        for (Signature signer : oldSigners) if (!Arrays.asList(newSigners).contains(signer))
            throw new IllegalStateException("更新包签名不同，请发布使用原签名密钥的 APK。");
    }
    private synchronized void fail(Exception exception) {
        state = "error";
        error = exception.getMessage() == null ? "更新失败，请检查网络后重试。" : exception.getMessage();
        if (exception instanceof java.io.IOException) error = "无法连接 GitHub 或下载失败，请检查网络后重试。";
    }
    private static String readText(String url) throws Exception {
        HttpURLConnection connection = open(url);
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 65536) throw new IllegalStateException("更新清单过大。");
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        } finally { connection.disconnect(); }
    }
    private static HttpURLConnection open(String initial) throws Exception {
        String url = initial;
        for (int redirects = 0; redirects < 6; redirects++) {
            if (!UpdateRelease.allowedDownload(url)) throw new IllegalStateException("更新下载地址不受信任。");
            HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15_000); connection.setReadTimeout(20_000);
            connection.setUseCaches(false); connection.setRequestProperty("User-Agent", "DingDian-Android-Updater");
            connection.setRequestProperty("Cache-Control", "no-cache");
            try {
                int code = connection.getResponseCode();
                if (code == 200) return connection;
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String next = connection.getHeaderField("Location");
                    if (next == null) throw new java.io.IOException("缺少下载跳转地址。");
                    url = new URL(new URL(url), next).toString();
                } else if (code == 404) throw new IllegalStateException("最新 Release 未提供更新文件，请在 GitHub 查看下载。");
                else throw new java.io.IOException("GitHub HTTP " + code);
            } catch (Exception e) { connection.disconnect(); throw e; }
            connection.disconnect();
        }
        throw new java.io.IOException("下载跳转过多。");
    }
    private static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder();
        for (byte b : bytes) value.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return value.toString();
    }
}
