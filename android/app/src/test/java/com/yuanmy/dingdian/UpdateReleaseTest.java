package com.yuanmy.dingdian;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public final class UpdateReleaseTest {
    private JSONObject manifest() throws Exception {
        return new JSONObject().put("schema", 1).put("packageName", "com.yuanmy.dingdian")
            .put("versionName", "1.1.0").put("versionCode", 3).put("minSdk", 28).put("size", 200000)
            .put("sha256", "a".repeat(64)).put("apkUrl", UpdateRelease.REPO + "/releases/download/v1.1.0/dingdian-1.1.0-android.apk")
            .put("notes", "增加应用内更新");
    }
    @Test public void acceptsStableManifestWithIntegrityMetadata() throws Exception {
        UpdateRelease value = new UpdateRelease(manifest());
        assertEquals(3, value.code); assertEquals("1.1.0", value.version);
        assertEquals(UpdateRelease.REPO + "/releases/tag/v1.1.0", value.page);
    }
    private void rejects(String key, Object value) throws Exception {
        try { new UpdateRelease(manifest().put(key, value)); fail("Accepted invalid " + key); }
        catch (IllegalArgumentException expected) {}
    }
    @Test public void rejectsWrongAppVersionAndInvalidDigest() throws Exception {
        rejects("packageName", "another.app"); rejects("versionCode", 0); rejects("schema", 2);
        rejects("versionName", "1.2.0-beta"); rejects("sha256", "broken"); rejects("minSdk", 0);
    }
    @Test public void rejectsOversizedFilesAndMismatchedReleaseAssets() throws Exception {
        rejects("size", UpdateRelease.MAX_APK_BYTES + 1); rejects("size", 0);
        rejects("apkUrl", "https://example.com/update.apk");
        rejects("apkUrl", UpdateRelease.REPO + "/releases/download/v1.0.0/dingdian-1.0.0-android.apk");
    }
    @Test public void redirectValidationRequiresExactHttpsHosts() {
        assertTrue(UpdateRelease.allowedDownload(UpdateRelease.MANIFEST));
        assertTrue(UpdateRelease.allowedDownload("https://release-assets.githubusercontent.com/github-production-release-asset/a?token=abc"));
        for (String url : new String[]{"http://github.com/Yuanmy621/IP-change/releases/a", "https://github.com.attacker.com/a", "https://github.com/other/project/releases/a", "https://github.com:444/Yuanmy621/IP-change/releases/a", "https://user@github.com/Yuanmy621/IP-change/releases/a", "file:///tmp/a.apk"})
            assertFalse(url, UpdateRelease.allowedDownload(url));
    }
    @Test public void comparesBuildCodesWithoutDowngrading() throws Exception {
        UpdateRelease value = new UpdateRelease(manifest());
        assertTrue(value.newerThan(1)); assertTrue(value.newerThan(2));
        assertFalse(value.newerThan(3)); assertFalse(value.newerThan(4));
    }
    @Test public void rejectsTruncatedOrCorruptedDownloads() throws Exception {
        UpdateRelease value = new UpdateRelease(manifest());
        value.verifyDownload(value.size, value.sha256);
        for (long size : new long[]{0, value.size - 1, value.size + 1}) {
            try { value.verifyDownload(size, value.sha256); fail("Accepted wrong size"); }
            catch (IllegalStateException expected) {}
        }
        try { value.verifyDownload(value.size, "b".repeat(64)); fail("Accepted bad digest"); }
        catch (IllegalStateException expected) {}
    }
}
