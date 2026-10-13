package com.yuanmy.dingdian;

import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationManager;
import android.os.SystemClock;
import android.test.InstrumentationTestCase;
import android.test.InstrumentationTestRunner;

/** Exercises the Android 9 native API without relying on its obsolete bundled WebView. */
public final class NativeFlowTest extends InstrumentationTestCase {
    public void testNativeProvidersRefreshUpdateAndRestore() throws Exception {
        assertEquals("Explicit emulator exercise is required", "true",
            ((InstrumentationTestRunner) getInstrumentation()).getArguments().getString("exerciseMock"));
        Context target = getInstrumentation().getTargetContext();
        LocationController controller = ((DingDianApp) target.getApplicationContext()).controller();
        assertFalse("Restore existing session before exercising", controller.pending());
        try {
            controller.apply(31.2304, 121.4737, true);
            LocationManager manager = target.getSystemService(LocationManager.class);
            for (String provider : new String[]{"gps", "network"}) {
                Location fix = manager.getLastKnownLocation(provider);
                assertNotNull(fix); assertTrue(fix.isFromMockProvider());
                assertEquals(31.2304, fix.getLatitude(), 0.000001);
                assertEquals(121.4737, fix.getLongitude(), 0.000001);
            }
            String before = controller.status().getString("last_refresh");
            target.startForegroundService(new Intent(target, MockLocationService.class));
            SystemClock.sleep(4500);
            assertTrue(controller.active());
            assertFalse("Service did not refresh", before.equals(controller.status().getString("last_refresh")));
            controller.apply(23.1291, 113.2644, true);
            assertEquals(23.1291, manager.getLastKnownLocation("gps").getLatitude(), 0.000001);
            controller.restore();
            assertFalse(controller.active()); assertFalse(controller.pending());
            assertFalse(target.getSharedPreferences("location_recovery", Context.MODE_PRIVATE).contains("session"));
        } finally {
            controller.restore();
            target.stopService(new Intent(target, MockLocationService.class));
        }
    }
}
