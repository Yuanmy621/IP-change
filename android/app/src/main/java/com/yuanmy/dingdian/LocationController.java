package com.yuanmy.dingdian;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AppOpsManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.Criteria;
import android.location.LocationManager;
import android.location.provider.ProviderProperties;
import android.os.Build;
import android.os.Process;
import android.os.PowerManager;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

final class LocationController {
    private final Context context;
    private final LocationManager locations;
    private final SharedPreferences journal;
    private final List<String> providers = new ArrayList<>();
    private boolean active, corrupt;
    private double latitude, longitude;
    private String error = "", lastRefresh = "";

    LocationController(Context context) {
        this.context = context.getApplicationContext();
        locations = context.getSystemService(LocationManager.class);
        journal = context.getSharedPreferences("location_recovery", Context.MODE_PRIVATE);
        String saved = journal.getString("session", "");
        if (!saved.isEmpty()) {
            try {
                JSONObject session = new JSONObject(saved);
                latitude = session.getDouble("latitude"); longitude = session.getDouble("longitude");
                validate(latitude, longitude);
                JSONArray owned = session.getJSONArray("providers");
                if (owned.length() < 1 || owned.length() > 2) throw new IllegalArgumentException();
                for (int i = 0; i < owned.length(); i++) {
                    String provider = owned.getString(i);
                    if (!Arrays.asList("gps", "network").contains(provider) || providers.contains(provider)) throw new IllegalArgumentException();
                    providers.add(provider);
                }
                error = "上次会话未完成恢复。请先点击「恢复真实定位」。";
            } catch (Exception e) { corrupt = true; error = "恢复记录无法读取，请保留应用数据并检查。"; }
        }
    }
    static void validate(double lat, double lon) {
        if (!Double.isFinite(lat) || !Double.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
            throw new IllegalArgumentException("纬度应在 -90～90，经度应在 -180～180");
    }
    boolean hasLocationPermission() { return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED; }
    boolean isMockApp() {
        return context.getSystemService(AppOpsManager.class).checkOpNoThrow("android:mock_location", Process.myUid(), context.getPackageName()) == AppOpsManager.MODE_ALLOWED;
    }
    String setup() {
        if (!hasLocationPermission()) return "请允许定点使用精确位置信息，再返回此页面。";
        if (!isMockApp()) return "点击下方按钮，在开发者选项中将「定点」选为模拟位置信息应用。";
        if (!locations.isLocationEnabled()) return "请在手机设置中开启位置信息。";
        return "已完成授权。手机可独立运行，无需电脑或数据线。";
    }
    JSONObject compatibility() throws Exception {
        boolean unrestricted = context.getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(context.getPackageName());
        boolean notifications = context.getSystemService(NotificationManager.class).areNotificationsEnabled();
        return new JSONObject().put("platform", "android").put("manufacturer", Build.MANUFACTURER)
            .put("model", Build.MODEL).put("android", Build.VERSION.RELEASE).put("sdk", Build.VERSION.SDK_INT)
            .put("precise_location", hasLocationPermission()).put("mock_app", isMockApp())
            .put("location_enabled", locations.isLocationEnabled()).put("notifications", notifications)
            .put("battery_unrestricted", unrestricted)
            .put("provider_api", Build.VERSION.SDK_INT >= 31 ? "Android 12+" : "Android 9–11")
            .put("guidance", "适用于支持标准模拟位置接口的 Android 9+ 手机。开发者选项中搜索「模拟位置」，选择定点。"
                + (!notifications ? "通知未开启，请在应用设置中开启，以便从通知栏恢复。" : "")
                + (!unrestricted ? "若切后台后停止刷新，请在应用电量设置中允许后台运行；部分厂商还需手动允许自启动。" : ""));
    }
    synchronized JSONObject status() throws Exception {
        JSONObject result = new JSONObject();
        result.put("devices", new JSONArray().put(new JSONObject().put("serial", "local").put("model", Build.MODEL).put("state", "device")));
        result.put("ready", !corrupt && hasLocationPermission() && isMockApp() && locations.isLocationEnabled());
        result.put("setup", setup()); result.put("active", active); result.put("error", error); result.put("last_refresh", lastRefresh);
        result.put("compatibility", compatibility());
        result.put("session", providers.isEmpty() && !corrupt ? JSONObject.NULL : session());
        return result;
    }
    private JSONObject session() throws Exception {
        return new JSONObject().put("serial", "local").put("latitude", latitude).put("longitude", longitude).put("providers", new JSONArray(providers));
    }
    private void save() throws Exception {
        SharedPreferences.Editor edit = journal.edit();
        if (providers.isEmpty()) edit.remove("session"); else edit.putString("session", session().toString());
        if (!edit.commit()) throw new IllegalStateException("无法保存恢复记录，已停止操作。");
    }
    synchronized void apply(double lat, double lon, boolean network) throws Exception {
        validate(lat, lon);
        if (corrupt) throw new IllegalStateException(error);
        if (!providers.isEmpty() && !active) throw new IllegalStateException("存在待恢复会话，请先恢复真实定位。");
        if (!hasLocationPermission() || !isMockApp() || !locations.isLocationEnabled()) throw new IllegalStateException(setup());
        List<String> wanted = network ? Arrays.asList("gps", "network") : Arrays.asList("gps");
        if (!providers.isEmpty() && !providers.equals(wanted)) throw new IllegalStateException("请先恢复真实定位，再更换定位源。");
        if (providers.isEmpty()) {
            // Reject another tool's test providers instead of replacing them.
            for (String provider : Arrays.asList("gps", "network")) {
                if (!locations.getAllProviders().contains(provider)) continue;
                Location previous;
                try { previous = locations.getLastKnownLocation(provider); }
                catch (SecurityException denied) { throw new IllegalStateException("精确定位权限已变更，请重新授权后重试。", denied); }
                if (previous != null && previous.isFromMockProvider()) throw new IllegalStateException("检测到其他工具的模拟位置。请先在原工具中恢复并退出。");
            }
        }
        latitude = lat; longitude = lon;
        try {
            for (String provider : wanted) {
                if (providers.contains(provider)) continue;
                providers.add(provider); save(); // Save ownership intent before changing the system.
                if (Build.VERSION.SDK_INT >= 31) {
                    ProviderProperties properties = new ProviderProperties.Builder()
                        .setHasSatelliteRequirement(provider.equals("gps"))
                        .setHasNetworkRequirement(provider.equals("network"))
                        .setHasAltitudeSupport(true).setHasSpeedSupport(true).setHasBearingSupport(true)
                        .setPowerUsage(ProviderProperties.POWER_USAGE_LOW).setAccuracy(ProviderProperties.ACCURACY_FINE).build();
                    locations.addTestProvider(provider, properties);
                } else {
                    addLegacyProvider(provider);
                }
                locations.setTestProviderEnabled(provider, true);
            }
            save(); inject(); active = true; error = "";
        } catch (Exception failure) {
            try { restore(); } catch (Exception cleanup) { error = "恢复未完成：" + cleanup.getMessage(); }
            throw new IllegalStateException(failure.getMessage() + (error.isEmpty() ? "" : "；" + error), failure);
        }
    }
    @SuppressLint("WrongConstant")
    private void addLegacyProvider(String provider) {
        // SDK 31+ annotates this old overload with ProviderProperties constants.
        // Criteria's public pre-31 constants have the same integer values (1).
        locations.addTestProvider(provider, provider.equals("network"), provider.equals("gps"), false, false,
            true, true, true, Criteria.POWER_LOW, Criteria.ACCURACY_FINE);
    }
    private void inject() {
        for (String provider : providers) {
            Location location = new Location(provider);
            location.setLatitude(latitude); location.setLongitude(longitude); location.setAccuracy(5f);
            location.setAltitude(0); location.setSpeed(0); location.setBearing(0);
            location.setTime(System.currentTimeMillis()); location.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos());
            locations.setTestProviderLocation(provider, location);
        }
        lastRefresh = Instant.now().toString();
    }
    synchronized void refresh() {
        if (!active) return;
        try { inject(); }
        catch (Exception e) { active = false; error = "定位刷新已停止：" + e.getMessage() + "。请恢复真实定位。"; }
    }
    synchronized boolean active() { return active; }
    synchronized boolean pending() { return !providers.isEmpty() || corrupt; }
    synchronized void restore() throws Exception {
        active = false;
        if (corrupt) throw new IllegalStateException(error);
        try {
            while (!providers.isEmpty()) {
                String provider = providers.get(providers.size() - 1);
                locations.removeTestProvider(provider);
                providers.remove(providers.size() - 1); save();
            }
            error = ""; lastRefresh = "";
        } catch (Exception e) { error = "恢复未完成，请重新选择定点作为模拟位置应用并重试：" + e.getMessage(); throw new IllegalStateException(error, e); }
    }
}
