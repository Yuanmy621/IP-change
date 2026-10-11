package com.yuanmy.dingdian;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.test.InstrumentationTestCase;
import org.json.JSONObject;

public final class ControllerTest extends InstrumentationTestCase {
    private SharedPreferences preferences;
    private Context isolated;
    @Override protected void setUp() throws Exception {
        super.setUp();
        Context target = getInstrumentation().getTargetContext();
        preferences = target.getSharedPreferences("test_recovery", Context.MODE_PRIVATE);
        preferences.edit().clear().commit();
        isolated = new ContextWrapper(target) {
            @Override public SharedPreferences getSharedPreferences(String name, int mode) { return preferences; }
        };
    }
    @Override protected void tearDown() throws Exception { preferences.edit().clear().commit(); super.tearDown(); }
    public void testInvalidCoordinatesNeverCreateSession() throws Exception {
        LocationController controller = new LocationController(isolated);
        for (double[] point : new double[][]{{91, 0}, {0, 181}, {Double.NaN, 0}, {0, Double.POSITIVE_INFINITY}}) {
            try { controller.apply(point[0], point[1], false); fail("Invalid position accepted"); }
            catch (IllegalArgumentException expected) {}
        }
        assertFalse(controller.pending()); assertFalse(preferences.contains("session"));
    }
    public void testRecoveryRecordRequiresRestoreBeforeApply() throws Exception {
        String saved = "{\"latitude\":31.2304,\"longitude\":121.4737,\"providers\":[\"gps\"]}";
        preferences.edit().putString("session", saved).commit();
        LocationController controller = new LocationController(isolated);
        JSONObject state = controller.status();
        assertFalse(state.getBoolean("active")); assertTrue(controller.pending());
        try { controller.apply(1, 2, false); fail("Pending session overwritten"); }
        catch (IllegalStateException expected) {}
        assertEquals(saved, preferences.getString("session", ""));
    }
    public void testCorruptRecoveryIsPreserved() throws Exception {
        preferences.edit().putString("session", "broken").commit();
        LocationController controller = new LocationController(isolated);
        assertTrue(controller.pending()); assertFalse(controller.status().getBoolean("ready"));
        try { controller.restore(); fail("Corrupt recovery ignored"); }
        catch (IllegalStateException expected) {}
        assertEquals("broken", preferences.getString("session", ""));
    }
}
