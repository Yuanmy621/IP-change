package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestPlaceSearchCoordinatesCacheAndValidation(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Query().Get("q") != "上海" || r.URL.Query().Get("limit") != "5" {
			t.Error("query parameters not preserved")
		}
		if !strings.HasPrefix(r.Header.Get("User-Agent"), "DingDian-") {
			t.Error("application identification missing")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"features":[{"geometry":{"type":"Point","coordinates":[121.47,31.23]},"properties":{"name":"上海","city":"上海","country":"中国"}},{"geometry":{"type":"Point","coordinates":[121.47,31.23]},"properties":{"name":"上海","city":"上海","country":"中国"}},{"geometry":{"type":"Point","coordinates":[200,31]},"properties":{"name":"invalid"}},{"geometry":{"type":"Point","coordinates":[]},"properties":{"name":"missing"}}]}`))
	}))
	defer server.Close()
	s := newPlaceSearch(server.URL)
	places, err := s.search(context.Background(), " 上海 ")
	if err != nil {
		t.Fatal(err)
	}
	if len(places) != 1 || places[0].Latitude != 31.23 || places[0].Longitude != 121.47 || places[0].Name != "上海 · 中国" {
		t.Fatalf("unexpected places: %+v", places)
	}
	if _, err = s.search(context.Background(), "上海"); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatal("repeat query did not use cache")
	}
	if _, err = s.search(context.Background(), "北京"); err == nil {
		t.Fatal("request rate was not limited")
	}
	for _, query := range []string{"", strings.Repeat("地", 201)} {
		if _, err = s.search(context.Background(), query); err == nil {
			t.Fatal("invalid query accepted")
		}
	}
	if calls.Load() != 1 {
		t.Fatal("rejected queries reached provider")
	}
}
func TestPlaceSearchUnavailableAndMalformedResponses(t *testing.T) {
	for _, tt := range []struct {
		code int
		body string
	}{{429, ""}, {503, ""}, {200, "not json"}} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tt.code); _, _ = w.Write([]byte(tt.body)) }))
		s := newPlaceSearch(server.URL)
		if _, err := s.search(context.Background(), "上海"); err == nil {
			t.Fatal("provider failure was not reported")
		}
		server.Close()
	}
}

func TestChineseCityPrefixIsSeparatedAndSharesCache(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Query().Get("q") != "上海 人民广场" {
			t.Error("city and place were not separated")
		}
		_, _ = w.Write([]byte(`{"features":[]}`))
	}))
	defer server.Close()
	s := newPlaceSearch(server.URL)
	for _, query := range []string{"上海人民广场", "上海 人民广场"} {
		if _, err := s.search(context.Background(), query); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatal("equivalent city queries did not share cache")
	}
}
func TestPlaceSearchHTTPWorksWithoutConnectedPhone(t *testing.T) {
	var providerCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls.Add(1)
		_, _ = w.Write([]byte(`{"features":[]}`))
	}))
	defer server.Close()
	f := newPhone()
	f.connected = false
	c := control(t, f)
	c.searcher = newPlaceSearch(server.URL)
	h := handler(c, "127.0.0.1:8765", "secret", func() {})
	request := func(token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8765/api/places/search", strings.NewReader(`{"query":"上海"}`))
		r.Header.Set("X-Session-Token", token)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request("wrong"); w.Code != 401 {
		t.Fatal("search accepted unauthorized request")
	}
	if providerCalls.Load() != 0 {
		t.Fatal("unauthorized request reached provider")
	}
	if w := request("secret"); w.Code != 200 || strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatal("search failed without a phone:", w.Body.String())
	}
	if len(f.calls) > 0 {
		t.Fatal("place search issued an ADB command")
	}
}
