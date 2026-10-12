package com.yuanmy.dingdian;
import org.junit.Test;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;
public class CurrentLocationTest {
    @Test public void acceptsOnlyRecentRealFiniteCoordinates() {
        assertTrue(CurrentLocation.usable(0, 0, 0, false));
        assertTrue(CurrentLocation.usable(39.9042,116.4074,TimeUnit.SECONDS.toNanos(15),false));
        assertFalse(CurrentLocation.usable(39.9042,116.4074,0,true));
        assertFalse(CurrentLocation.usable(39.9042,116.4074,TimeUnit.SECONDS.toNanos(15)+1,false));
        assertFalse(CurrentLocation.usable(39.9042,116.4074,-1,false));
        assertFalse(CurrentLocation.usable(Double.NaN,0,0,false));
        assertFalse(CurrentLocation.usable(0,Double.POSITIVE_INFINITY,0,false));
        assertFalse(CurrentLocation.usable(91,0,0,false));
        assertFalse(CurrentLocation.usable(0,-181,0,false));
    }
}
