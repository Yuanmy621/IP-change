package com.yuanmy.dingdian;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.widget.Toast;

public final class MockLocationService extends Service {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LocationController controller;
    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            controller.refresh();
            if (!controller.active()) notifyState("定位刷新已暂停，请打开定点恢复");
            handler.postDelayed(this, 2000);
        }
    };
    @Override public void onCreate() {
        super.onCreate();
        controller = ((DingDianApp) getApplication()).controller();
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("mock_location", "定位服务与恢复", NotificationManager.IMPORTANCE_LOW));
    }
    private Notification notification(String message) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent reset = PendingIntent.getService(this, 1, new Intent(this, MockLocationService.class).setAction("restore"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, "mock_location").setSmallIcon(R.drawable.ic_location)
            .setContentTitle("定点 · 手机定位服务").setContentText(message).setContentIntent(open).setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "恢复真实定位", reset).build()).build();
    }
    private void notifyState(String message) { getSystemService(NotificationManager.class).notify(7, notification(message)); }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (Build.VERSION.SDK_INT >= 34) startForeground(7, notification("模拟位置正在刷新，点击打开控制页"), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(7, notification("模拟位置正在刷新，点击打开控制页"));
        if (intent != null && "restore".equals(intent.getAction())) {
            try { controller.restore(); stopSelf(); }
            catch (Exception e) { notifyState("恢复未完成，请打开定点处理"); Toast.makeText(this, "恢复未完成，请打开定点重试", Toast.LENGTH_LONG).show(); }
        } else if (controller.active()) {
            handler.removeCallbacks(refresh); handler.post(refresh);
        } else if (!controller.pending()) stopSelf();
        else notifyState("存在待恢复会话，请打开定点恢复");
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        handler.removeCallbacks(refresh);
        if (controller.pending()) try { controller.restore(); } catch (Exception ignored) { /* Journal remains for the next user-started session. */ }
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
