package com.yuanmy.dingdian;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.HashSet;
import java.util.Set;

final class PlaceSearch {
    private final LinkedHashMap<String, Entry> cache = new LinkedHashMap<>();
    private long lastRequest;
    private static final class Entry {
        final JSONArray values; final long expiry;
        Entry(JSONArray values) { this.values = values; expiry = System.currentTimeMillis() + 1800000; }
    }
    synchronized JSONArray search(String query) throws Exception {
        query = query.trim().replaceAll("\\s+", " ");
        if (query.isEmpty() || query.codePointCount(0, query.length()) > 200) throw new IllegalArgumentException("请输入 1～200 字的地名或地址");
        if (!query.contains(" ")) query = query.replaceFirst("^(北京|上海|天津|重庆)(市)?([^\\s].*)$", "$1$2 $3");
        long now = System.currentTimeMillis();
        Entry cached = cache.get(query);
        if (cached != null && cached.expiry > now) return cached.values;
        if (now - lastRequest < 1000) throw new IllegalStateException("搜索过于频繁，请稍等一秒再试");
        lastRequest = now;
        URL url = new URL("https://photon.komoot.io/api/?limit=5&q=" + URLEncoder.encode(query, "UTF-8"));
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
        connection.setRequestProperty("User-Agent", "DingDian-Android/0.2 (personal location testing)");
        connection.setRequestProperty("Accept", "application/json");
        try {
            int code = connection.getResponseCode();
            if (code != 200) throw new IllegalStateException("地名搜索服务暂不可用（" + code + "），可直接输入经纬度");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] chunk = new byte[4096]; int count;
                while ((count = input.read(chunk)) != -1) {
                    if (bytes.size() + count > 1048576) throw new IllegalStateException("查询结果过大，请缩小搜索范围");
                    bytes.write(chunk, 0, count);
                }
            }
            JSONArray features = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name())).getJSONArray("features");
            JSONArray result = new JSONArray(); Set<String> seen = new HashSet<>();
            for (int i = 0; i < features.length() && result.length() < 5; i++) {
                JSONObject feature = features.optJSONObject(i);
                if (feature == null) continue;
                JSONObject geometry = feature.optJSONObject("geometry"), properties = feature.optJSONObject("properties");
                if (geometry == null || properties == null || !"Point".equals(geometry.optString("type"))) continue;
                JSONArray point = geometry.optJSONArray("coordinates");
                if (point == null || point.length() != 2) continue;
                double lon = point.optDouble(0, Double.NaN), lat = point.optDouble(1, Double.NaN);
                try { LocationController.validate(lat, lon); } catch (IllegalArgumentException e) { continue; }
                StringBuilder name = new StringBuilder(); Set<String> parts = new HashSet<>();
                for (String key : new String[]{"name", "street", "housenumber", "district", "city", "state", "country"}) {
                    Object value = properties.opt(key);
                    if (value instanceof String && !((String) value).isEmpty() && parts.add((String) value)) {
                        if (name.length() > 0) name.append(" · "); name.append(value);
                    }
                }
                if (name.length() == 0 || !seen.add(name + "|" + lat + "|" + lon)) continue;
                result.put(new JSONObject().put("name", name.toString()).put("latitude", lat).put("longitude", lon));
            }
            cache.entrySet().removeIf(entry -> entry.getValue().expiry <= now);
            if (cache.size() >= 100) cache.remove(cache.keySet().iterator().next());
            cache.put(query, new Entry(result)); return result;
        } catch (java.io.IOException e) { throw new IllegalStateException("地名搜索服务无法连接，请检查网络或直接输入经纬度。", e); }
        finally { connection.disconnect(); }
    }
}
