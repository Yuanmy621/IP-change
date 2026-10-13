package com.yuanmy.dingdian;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.SystemClock;
import android.os.ParcelFileDescriptor;
import android.app.Instrumentation;
import android.test.InstrumentationTestCase;
import android.test.InstrumentationTestRunner;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

/** Opt-in real-device exercise. Normal test runs never inject a location. */
public final class PhoneFlowTest extends InstrumentationTestCase {
    private WebView web;
    private String evaluate(String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        getInstrumentation().runOnMainSync(() -> web.evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue("WebView callback timed out", done.await(5, TimeUnit.SECONDS));
        return result.get();
    }
    private WebView findWeb(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
            WebView found = findWeb(((ViewGroup) view).getChildAt(i)); if (found != null) return found;
        }
        return null;
    }
    private void awaitJavaScript(String condition) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 15000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(evaluate("Boolean(" + condition + ")"))) return;
            SystemClock.sleep(150);
        }
        fail("Page condition timed out: " + condition + "; message=" + evaluate("document.getElementById('message')?.textContent"));
    }
    public void testApplyBackgroundRefreshAndRestore() throws Exception {
        if (!"true".equals(((InstrumentationTestRunner) getInstrumentation()).getArguments().getString("exerciseMock"))) return;
        Context target = getInstrumentation().getTargetContext();
        LocationController controller = ((DingDianApp) target.getApplicationContext()).controller();
        assertFalse("Restore existing session before exercising", controller.pending());
        assertTrue(controller.setup(), controller.hasLocationPermission() && controller.isMockApp());
        // HyperOS may block a test process's background launch. Exercise the
        // public link as a user-launched shell intent and bound the wait.
        Instrumentation.ActivityMonitor monitor = getInstrumentation().addMonitor(MainActivity.class.getName(), null, false);
        Activity activity;
        try (ParcelFileDescriptor command = getInstrumentation().getUiAutomation().executeShellCommand("am start -a android.intent.action.VIEW -d dingdian://open")) {
            activity = getInstrumentation().waitForMonitorWithTimeout(monitor, 10000);
        } finally { getInstrumentation().removeMonitor(monitor); }
        assertNotNull("Public launch link did not open the control page", activity);
        web = findWeb(activity.findViewById(android.R.id.content)); assertNotNull(web);
        try {
            awaitJavaScript("window.NativeLocation && document.getElementById('apply') && document.getElementById('latitude')");
            evaluate("document.getElementById('latitude').value='31.2304';document.getElementById('longitude').value='121.4737';document.getElementById('latitude').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('longitude').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('network').checked=true;true");
            awaitJavaScript("!document.getElementById('apply').disabled");
            evaluate("document.getElementById('locationForm').requestSubmit();true");
            long deadline = SystemClock.elapsedRealtime() + 10000;
            while (!controller.active() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
            JSONObject state = controller.status(); assertTrue(state.toString(), state.getBoolean("active"));
            LocationManager locations = target.getSystemService(LocationManager.class);
            Location first = locations.getLastKnownLocation("gps"); assertNotNull(first); assertTrue(first.isFromMockProvider());
            assertEquals(31.2304, first.getLatitude(), 0.000001); assertEquals(121.4737, first.getLongitude(), 0.000001);
            Location network = locations.getLastKnownLocation("network"); assertNotNull(network); assertTrue(network.isFromMockProvider());
            String firstRefresh = controller.status().getString("last_refresh");
            target.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            SystemClock.sleep(4500);
            getInstrumentation().runOnMainSync(() -> assertFalse("Control page stayed in foreground", activity.hasWindowFocus()));
            assertTrue("Foreground service stopped in background", controller.active());
            assertFalse("Foreground service stopped refreshing in background", firstRefresh.equals(controller.status().getString("last_refresh")));
            target.startService(new Intent(target, MockLocationService.class).setAction("restore"));
            deadline = SystemClock.elapsedRealtime() + 5000;
            while (controller.pending() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
            assertFalse(controller.status().toString(), controller.pending()); assertFalse(controller.active());
            assertFalse(target.getSharedPreferences("location_recovery", Context.MODE_PRIVATE).contains("session"));
        } finally {
            controller.restore(); target.stopService(new Intent(target, MockLocationService.class));
            getInstrumentation().runOnMainSync(activity::finish);
        }
    }
}
