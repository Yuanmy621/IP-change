package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
)

type fakePhone struct {
	mu             sync.Mutex
	connected      bool
	mode           string
	providers      map[string]bool
	positions      map[string]string
	failProvider   string
	denyPermission bool
	dump           string
	calls          []string
}

func newPhone() *fakePhone {
	return &fakePhone{connected: true, mode: "ignore", providers: map[string]bool{}, positions: map[string]string{}}
}
func (f *fakePhone) run(args ...string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, strings.Join(args, " "))
	if slices.Equal(args, []string{"devices", "-l"}) {
		if f.connected {
			return "List of devices attached\nK80 device product:zorn model:Redmi_K80 transport_id:1", nil
		}
		return "List of devices attached", nil
	}
	if !f.connected {
		return "", errors.New("device not found")
	}
	if len(args) < 4 || args[0] != "-s" || args[1] != "K80" || args[2] != "shell" {
		return "", errors.New("unexpected device")
	}
	a := args[3:]
	if slices.Equal(a, []string{"cmd", "location", "help"}) {
		return "add-test-provider remove-test-provider set-test-provider-location", nil
	}
	if slices.Equal(a, []string{"cmd", "location", "is-location-enabled"}) {
		return "true", nil
	}
	if slices.Equal(a, []string{"dumpsys", "location"}) {
		return f.dump, nil
	}
	if a[0] == "getprop" {
		return "15", nil
	}
	if len(a) == 4 && a[0] == "appops" && a[1] == "get" {
		return "Uid mode: MOCK_LOCATION: " + f.mode, nil
	}
	if len(a) == 5 && a[0] == "appops" && a[1] == "set" {
		if !f.denyPermission {
			f.mode = a[4]
		}
		return "", nil
	}
	if len(a) >= 5 && a[0] == "cmd" && a[1] == "location" && a[2] == "providers" {
		p := a[4]
		switch a[3] {
		case "add-test-provider":
			if p == f.failProvider {
				return "", errors.New("manufacturer refused provider")
			}
			f.providers[p] = true
		case "remove-test-provider":
			delete(f.providers, p)
			delete(f.positions, p)
		case "set-test-provider-enabled":
			if !f.providers[p] {
				return "", errors.New("not a test provider")
			}
		case "set-test-provider-location":
			if !f.providers[p] {
				return "", errors.New("not a test provider")
			}
			f.positions[p] = a[6]
		default:
			return "", errors.New("unexpected provider command")
		}
		return "", nil
	}
	return "", errors.New("unexpected command: " + strings.Join(a, " "))
}
func control(t *testing.T, f *fakePhone) *controller {
	t.Helper()
	return &controller{run: f.run, journal: filepath.Join(t.TempDir(), "session.json")}
}
func coords(lat, lon float64) position {
	return position{Serial: "K80", Latitude: &lat, Longitude: &lon}
}

func TestApplyUpdateAndRestoreOriginalPermission(t *testing.T) {
	f := newPhone()
	c := control(t, f)
	p := coords(31.2304, 121.4737)
	p.Network = true
	if err := c.set(p); err != nil {
		t.Fatal(err)
	}
	if !c.active || len(f.providers) != 2 || f.mode != "allow" {
		t.Fatal("mock session was not enabled")
	}
	if _, err := os.Stat(c.journal); err != nil {
		t.Fatal("recovery journal missing")
	}
	p = coords(39.9042, 116.4074)
	p.Network = true
	if err := c.set(p); err != nil {
		t.Fatal(err)
	}
	if f.positions["gps"] != "39.9042000,116.4074000" {
		t.Fatal("new coordinates not injected")
	}
	if err := c.reset(); err != nil {
		t.Fatal(err)
	}
	if len(f.providers) != 0 || f.mode != "ignore" || c.current != nil {
		t.Fatal("original state not restored")
	}
	if _, err := os.Stat(c.journal); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("journal not removed after restore")
	}
}
func TestFailedInitializationRollsBack(t *testing.T) {
	f := newPhone()
	f.failProvider = "network"
	c := control(t, f)
	p := coords(1, 2)
	p.Network = true
	if err := c.set(p); err == nil {
		t.Fatal("expected manufacturer failure")
	}
	if c.active || c.current != nil || len(f.providers) != 0 || f.mode != "ignore" {
		t.Fatal("partial initialization left phone modified")
	}
}
func TestSilentPermissionDenialDoesNotClaimSuccess(t *testing.T) {
	f := newPhone()
	f.denyPermission = true
	c := control(t, f)
	if err := c.set(coords(1, 2)); err == nil {
		t.Fatal("silent permission denial accepted")
	}
	if c.active || len(f.providers) > 0 || f.mode != "ignore" {
		t.Fatal("denied permission resulted in an active session")
	}
}
func TestDisconnectAndRestartPreserveRecovery(t *testing.T) {
	f := newPhone()
	c := control(t, f)
	if err := c.set(coords(1, 2)); err != nil {
		t.Fatal(err)
	}
	f.connected = false
	if err := c.reset(); err == nil {
		t.Fatal("disconnected cleanup claimed success")
	}
	if c.current == nil || c.active {
		t.Fatal("recovery state lost")
	}
	next := &controller{run: f.run, journal: c.journal}
	if err := next.load(); err != nil {
		t.Fatal(err)
	}
	if next.current == nil || next.active {
		t.Fatal("restart must wait for explicit recovery")
	}
	f.connected = true
	if err := next.set(coords(3, 4)); err == nil {
		t.Fatal("pending recovery allowed a new session")
	}
	if err := next.reset(); err != nil {
		t.Fatal(err)
	}
	if f.mode != "ignore" || len(f.providers) > 0 {
		t.Fatal("restart recovery failed")
	}
}
func TestRejectInvalidInputBeforeAnyCommand(t *testing.T) {
	f := newPhone()
	c := control(t, f)
	for _, p := range []position{coords(91, 0), coords(0, 181), {Serial: "K80"}} {
		if c.set(p) == nil {
			t.Fatal("invalid input accepted")
		}
	}
	if len(f.calls) != 0 {
		t.Fatal("invalid input reached ADB")
	}
}
func TestDoesNotReplaceExistingMockProvider(t *testing.T) {
	f := newPhone()
	f.dump = "gps provider:\n  last mock location=null"
	c := control(t, f)
	if err := c.set(coords(1, 2)); err == nil {
		t.Fatal("preexisting mock provider was not rejected")
	}
	if c.current != nil || f.mode != "ignore" {
		t.Fatal("preexisting mock provider changed")
	}
}
func TestSessionCannotSwitchDeviceOrProviderWithoutReset(t *testing.T) {
	f := newPhone()
	c := control(t, f)
	if err := c.set(coords(1, 2)); err != nil {
		t.Fatal(err)
	}
	p := coords(3, 4)
	p.Network = true
	if c.set(p) == nil {
		t.Fatal("provider changed without recovery")
	}
	if f.positions["gps"] != "1.0000000,2.0000000" {
		t.Fatal("rejected switch changed coordinates")
	}
}
func TestHTTPRejectsUnauthorizedCrossOriginAndOversizedRequests(t *testing.T) {
	f := newPhone()
	c := control(t, f)
	h := handler(c, "127.0.0.1:8765", "secret", func() {})
	tests := []struct {
		host, origin, token, body string
		want                      int
	}{
		{"127.0.0.1:8765", "", "", "{}", 401},
		{"evil.example", "", "secret", "{}", 403},
		{"127.0.0.1:8765", "https://evil.example", "secret", "{}", 403},
		{"127.0.0.1:8765", "", "secret", `{"serial":"K80","latitude":1}`, 400},
		{"127.0.0.1:8765", "", "secret", `{"serial":"K80","latitude":1,"longitude":2,"unknown":true}`, 400},
		{"127.0.0.1:8765", "", "secret", strings.Repeat(" ", 5000) + "{}", 400},
	}
	for _, tt := range tests {
		r := httptest.NewRequest(http.MethodPost, "http://"+tt.host+"/api/location/set", strings.NewReader(tt.body))
		r.Host = tt.host
		r.Header.Set("Origin", tt.origin)
		r.Header.Set("X-Session-Token", tt.token)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tt.want {
			t.Fatalf("got %d, want %d: %s", w.Code, tt.want, w.Body.String())
		}
	}
	if len(f.calls) != 0 {
		t.Fatal("rejected HTTP request reached ADB")
	}
	r := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8765/api/status", nil)
	r.Header.Set("X-Session-Token", "secret")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
}
func TestShutdownDoesNotExitIfPhoneCannotBeRestored(t *testing.T) {
	f := newPhone()
	c := control(t, f)
	if err := c.set(coords(1, 2)); err != nil {
		t.Fatal(err)
	}
	f.connected = false
	stopped := false
	h := handler(c, "127.0.0.1:8765", "secret", func() { stopped = true })
	r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8765/api/shutdown", strings.NewReader("{}"))
	r.Header.Set("X-Session-Token", "secret")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 400 || stopped {
		t.Fatal("tool exited without restoring disconnected phone")
	}
}
