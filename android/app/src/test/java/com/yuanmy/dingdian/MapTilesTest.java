package com.yuanmy.dingdian;

import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import static org.junit.Assert.*;

public class MapTilesTest {
    @Test public void restrictsPathsAndBoundsToFixedTileService() {
        assertEquals("12/3430/1674.png", MapTiles.tilePath("/map-tiles/12/3430/1674.png"));
        assertEquals("0/0/0.png", MapTiles.tilePath("/map-tiles/0/0/0.png"));
        for (String path : new String[]{"/map-tiles/20/0/0.png", "/map-tiles/1/2/0.png", "/map-tiles/1/0/2.png", "/map-tiles/1/-1/0.png", "/map-tiles/../0/0.png", "https://example.com/1/0/0.png", "/map-tiles/1/0/0.png?url=x"}) {
            assertThrows(IllegalArgumentException.class, () -> MapTiles.tilePath(path));
        }
    }
    @Test public void routesOnlySelectedProvidersWithoutCredentials() {
        assertEquals("https://webst02.is.autonavi.com/appmaptile?style=7&x=3430&y=1674&z=12", MapTiles.tileURL("/map-tiles/amap/12/3430/1674.png"));
        assertEquals("https://tile.openstreetmap.org/12/3430/1674.png", MapTiles.tileURL("/map-tiles/osm/12/3430/1674.png"));
        assertThrows(IllegalArgumentException.class, () -> MapTiles.tileURL("/map-tiles/evil/12/3430/1674.png"));
        assertThrows(IllegalArgumentException.class, () -> MapTiles.tileURL("/map-tiles/amap/1/2/0.png"));
    }
    @Test public void rejectsBlockedResponsesEvenIfStatusAndMimeAreSuccessful() throws Exception {
        byte[] png = {(byte)137, 80, 78, 71, 13, 10, 26, 10, 0};
        assertArrayEquals(png, MapTiles.readTile(new ByteArrayInputStream(png), "image/png", null));
        assertThrows(IOException.class, () -> MapTiles.readTile(new ByteArrayInputStream(png), "image/png", "Access denied"));
        assertThrows(IOException.class, () -> MapTiles.readTile(new ByteArrayInputStream(png), "text/html", null));
        assertThrows(IOException.class, () -> MapTiles.readTile(new ByteArrayInputStream(new byte[20]), "image/png", null));
        assertThrows(IOException.class, () -> MapTiles.readTile(new ByteArrayInputStream(new byte[512*1024+1]), "image/png", null));
    }
}
