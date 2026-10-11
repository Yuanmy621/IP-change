package com.yuanmy.dingdian;

import android.app.Application;

public final class DingDianApp extends Application {
    private LocationController controller;
    @Override public void onCreate() {
        super.onCreate();
        controller();
    }
    public synchronized LocationController controller() {
        if (controller == null) controller = new LocationController(this);
        return controller;
    }
}
