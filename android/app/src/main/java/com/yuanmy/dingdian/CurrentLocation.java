package com.yuanmy.dingdian;

import android.annotation.SuppressLint;
import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Foreground, bounded real sensor lookup. Never uses IP or stale last-known fixes. */
final class CurrentLocation {
    private final LocationManager manager;
    private final LocationController controller;
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile LocationListener pending;
    private volatile CountDownLatch waiting;
    CurrentLocation(Context context, LocationController controller) {
        manager = context.getSystemService(LocationManager.class); this.controller = controller;
    }
    static boolean usable(double lat, double lon, long ageNanos, boolean mock) {
        return !mock && Double.isFinite(lat) && Double.isFinite(lon) && Math.abs(lat) <= 90
            && Math.abs(lon) <= 180 && ageNanos >= 0 && ageNanos <= TimeUnit.SECONDS.toNanos(15);
    }
    @SuppressLint("MissingPermission")
    JSONObject read() throws Exception {
        if (!controller.hasLocationPermission()) throw new IllegalStateException("请先允许精确定位，再点击获取当前位置。");
        if (!manager.isLocationEnabled()) throw new IllegalStateException("请开启系统定位，再点击获取当前位置。");
        if (controller.pending()) throw new IllegalStateException("请先恢复真实定位，再获取当前位置。");
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<Location> fix = new AtomicReference<>();
        AtomicReference<Exception> failure = new AtomicReference<>();
        LocationListener listener = new LocationListener() {
            @Override public void onLocationChanged(Location location) {
                if (location.hasAccuracy() && Float.isFinite(location.getAccuracy()) && location.getAccuracy() >= 0 && usable(location.getLatitude(), location.getLongitude(), SystemClock.elapsedRealtimeNanos() - location.getElapsedRealtimeNanos(), location.isFromMockProvider())) {
                    fix.compareAndSet(null, new Location(location)); done.countDown();
                }
            }
            @Override public void onProviderEnabled(String provider) {}
            @Override public void onProviderDisabled(String provider) {}
            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
        };
        pending = listener; waiting = done;
        main.post(() -> {
            if (pending != listener) { done.countDown(); return; }
            try {
                boolean requested = false;
                for (String provider : new String[]{"gps", "network", "fused"}) {
                    try {
                        if (manager.getAllProviders().contains(provider) && manager.isProviderEnabled(provider)) {
                            manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper()); requested = true;
                        }
                    } catch (IllegalArgumentException | SecurityException unavailable) {
                        // A vendor-specific fused provider must not invalidate usable GPS/network requests.
                    }
                }
                if (!requested) { failure.set(new IllegalStateException("没有可用的定位源，请检查系统定位设置。")); done.countDown(); }
            } catch (Exception e) { failure.set(e); done.countDown(); }
        });
        try {
            if (!done.await(18, TimeUnit.SECONDS) || fix.get() == null) {
                if (failure.get() != null) throw new IllegalStateException("获取位置失败，请检查精确定位权限与系统定位开关。");
                throw new IllegalStateException("暂未获取到当前真实位置，请到信号较好的位置后重试，或手动选点。");
            }
            if (controller.pending()) throw new IllegalStateException("当前正在模拟定位，请先恢复真实定位。");
            Location location = fix.get();
            return new JSONObject().put("latitude", location.getLatitude()).put("longitude", location.getLongitude())
                .put("accuracy", location.getAccuracy()).put("time", location.getTime()).put("source", "device");
        } finally {
            if (pending == listener) pending = null;
            if (waiting == done) waiting = null;
            main.post(() -> manager.removeUpdates(listener));
        }
    }
    void cancel() {
        LocationListener listener = pending; pending = null;
        CountDownLatch done = waiting; if (done != null) done.countDown();
        if (listener != null) main.post(() -> manager.removeUpdates(listener));
    }
}
