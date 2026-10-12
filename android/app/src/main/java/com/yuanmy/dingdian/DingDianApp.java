package com.yuanmy.dingdian;

import android.app.Application;

public final class DingDianApp extends Application {
    private LocationController controller;
    private AppUpdater updater;
    @Override public void onCreate() {
        super.onCreate();
        controller();
    }
    public synchronized LocationController controller() {
        if (controller == null) controller = new LocationController(this);
        return controller;
    }
    public synchronized AppUpdater updater() {
        if (updater == null) updater = new AppUpdater(this);
        return updater;
    }
}
