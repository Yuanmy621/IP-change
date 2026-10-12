package com.yuanmy.dingdian;

import org.json.JSONObject;
import java.net.URI;

/** The release manifest is generated alongside the APK by prepare-release.py. */
final class UpdateRelease {
    static final String REPO = "https://github.com/Yuanmy621/IP-change";
    static final String MANIFEST = REPO + "/releases/latest/download/update.json";
    static final long MAX_APK_BYTES = 128L * 1024 * 1024;
    final String version, url, sha256, notes, page;
    final long code, size;
    final int minSdk;

    UpdateRelease(JSONObject json) throws Exception {
        if (json.getInt("schema") != 1 || !"com.yuanmy.dingdian".equals(json.getString("packageName")))
            throw new IllegalArgumentException("更新清单与定点不匹配。");
        version = json.getString("versionName");
        if (!version.matches("(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})"))
            throw new IllegalArgumentException("更新版本格式不正确。");
        code = json.getLong("versionCode"); size = json.getLong("size"); minSdk = json.getInt("minSdk");
        sha256 = json.getString("sha256").toLowerCase(java.util.Locale.ROOT);
        url = json.getString("apkUrl"); notes = json.optString("notes", "");
        page = REPO + "/releases/tag/v" + version;
        if (code < 1 || code > Integer.MAX_VALUE || size < 1 || size > MAX_APK_BYTES || minSdk < 28 || !sha256.matches("[a-f0-9]{64}"))
            throw new IllegalArgumentException("更新清单的版本、大小或摘要不正确。");
        if (!url.equals(REPO + "/releases/download/v" + version + "/dingdian-" + version + "-android.apk"))
            throw new IllegalArgumentException("更新包地址不属于指定 Release。");
    }

    boolean newerThan(long installedCode) { return code > installedCode; }
    void verifyDownload(long downloadedSize, String downloadedSha256) {
        if (downloadedSize != size || !sha256.equals(downloadedSha256))
            throw new IllegalStateException("更新包校验失败，请重新下载。");
    }

    static boolean allowedDownload(String value) {
        try {
            URI uri = new URI(value);
            if (!"https".equals(uri.getScheme()) || uri.getRawUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return false;
            String host = uri.getHost(), path = uri.getPath();
            return ("github.com".equals(host) && path.startsWith("/Yuanmy621/IP-change/releases/"))
                || "release-assets.githubusercontent.com".equals(host)
                || "objects.githubusercontent.com".equals(host);
        } catch (Exception e) { return false; }
    }
}
