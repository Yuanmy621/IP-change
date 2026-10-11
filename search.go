package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const defaultGeocoder = "https://photon.komoot.io/api/"

var cityPrefix = regexp.MustCompile(`^(北京|上海|天津|重庆)(市)?([^\s].*)$`)

type place struct {
	Name      string  `json:"name"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}
type cachedPlaces struct {
	places  []place
	expires time.Time
}
type placeSearch struct {
	mu          sync.Mutex
	endpoint    string
	client      *http.Client
	cache       map[string]cachedPlaces
	lastRequest time.Time
}

func newPlaceSearch(endpoint string) *placeSearch {
	return &placeSearch{endpoint: endpoint, client: &http.Client{Timeout: 10 * time.Second}, cache: map[string]cachedPlaces{}}
}
func (s *placeSearch) search(ctx context.Context, query string) ([]place, error) {
	query = strings.TrimSpace(query)
	if query == "" || utf8.RuneCountInString(query) > 200 {
		return nil, errors.New("请输入 1～200 字的地名或地址")
	}
	// Photon matches Chinese city and place names more accurately as separate terms.
	query = strings.Join(strings.Fields(query), " ")
	if !strings.Contains(query, " ") {
		if parts := cityPrefix.FindStringSubmatch(query); parts != nil {
			query = parts[1] + parts[2] + " " + parts[3]
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if cached, ok := s.cache[query]; ok && now.Before(cached.expires) {
		return cached.places, nil
	}
	if now.Sub(s.lastRequest) < time.Second {
		return nil, errors.New("搜索过于频繁，请稍等一秒再试")
	}
	endpoint, err := url.Parse(s.endpoint)
	if err != nil {
		return nil, errors.New("地名查询服务地址配置有误")
	}
	params := endpoint.Query()
	params.Set("q", query)
	params.Set("limit", "5")
	endpoint.RawQuery = params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "DingDian-LocalLocation/1.0 (personal desktop location tool)")
	req.Header.Set("Accept", "application/json")
	s.lastRequest = now
	response, err := s.client.Do(req)
	if err != nil {
		return nil, errors.New("地名搜索服务暂时无法连接。请检查网络，或直接输入经纬度。")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		if response.StatusCode == http.StatusTooManyRequests {
			return nil, errors.New("地名搜索服务请求过多，请稍后重试")
		}
		return nil, fmt.Errorf("地名搜索服务暂不可用（%d），可直接输入经纬度", response.StatusCode)
	}
	var payload struct {
		Features []struct {
			Geometry struct {
				Type        string    `json:"type"`
				Coordinates []float64 `json:"coordinates"`
			} `json:"geometry"`
			Properties map[string]json.RawMessage `json:"properties"`
		} `json:"features"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload); err != nil {
		return nil, errors.New("地名查询服务返回的数据无法读取，请稍后重试")
	}
	result := []place{}
	seen := map[string]bool{}
	for _, feature := range payload.Features {
		point := feature.Geometry.Coordinates
		if feature.Geometry.Type != "Point" || len(point) != 2 || math.IsNaN(point[0]) || math.IsNaN(point[1]) || math.IsInf(point[0], 0) || math.IsInf(point[1], 0) || math.Abs(point[0]) > 180 || math.Abs(point[1]) > 90 {
			continue
		}
		parts := []string{}
		for _, key := range []string{"name", "street", "housenumber", "district", "city", "state", "country"} {
			var value string
			if json.Unmarshal(feature.Properties[key], &value) == nil && value != "" && !containsString(parts, value) {
				parts = append(parts, value)
			}
		}
		if len(parts) == 0 {
			continue
		}
		p := place{Name: strings.Join(parts, " · "), Latitude: point[1], Longitude: point[0]}
		key := fmt.Sprintf("%s|%.7f|%.7f", p.Name, p.Latitude, p.Longitude)
		if !seen[key] {
			result = append(result, p)
			seen[key] = true
		}
		if len(result) == 5 {
			break
		}
	}
	// Keep a small in-memory cache; searches and coordinates are not written to disk.
	for key, cached := range s.cache {
		if now.After(cached.expires) {
			delete(s.cache, key)
		}
	}
	if len(s.cache) >= 100 {
		for key := range s.cache {
			delete(s.cache, key)
			break
		}
	}
	s.cache[query] = cachedPlaces{places: result, expires: time.Now().Add(30 * time.Minute)}
	return result, nil
}
func containsString(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}
