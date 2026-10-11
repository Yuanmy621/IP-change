package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed web
var assets embed.FS

type runner func(...string) (string, error)
type device struct {
	Serial string `json:"serial"`
	State  string `json:"state"`
	Model  string `json:"model"`
}
type position struct {
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	Serial    string   `json:"serial"`
	Network   bool     `json:"network"`
}
type session struct {
	Serial       string   `json:"serial"`
	Providers    []string `json:"providers"`
	PreviousMode string   `json:"previous_mode"`
	Latitude     float64  `json:"latitude"`
	Longitude    float64  `json:"longitude"`
}
type controller struct {
	mu          sync.Mutex
	run         runner
	journal     string
	current     *session
	active      bool
	lastError   string
	lastRefresh string
}

func adbRunner(path string) runner {
	return func(args ...string) (string, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, path, args...).CombinedOutput()
		s := strings.TrimSpace(string(out))
		if ctx.Err() != nil {
			return s, errors.New("手机响应超时，请检查 USB 连接和调试授权")
		}
		if err != nil || regexp.MustCompile(`(?im)SecurityException|IllegalArgumentException|^Error:|^Exception occurred`).MatchString(s) {
			if s == "" {
				s = fmt.Sprint(err)
			}
			return s, fmt.Errorf("ADB：%s", s)
		}
		return s, nil
	}
}
func (c *controller) shell(serial string, args ...string) (string, error) {
	return c.run(append([]string{"-s", serial, "shell"}, args...)...)
}
func (c *controller) devices() ([]device, error) {
	out, err := c.run("devices", "-l")
	if err != nil {
		return nil, err
	}
	list := []device{}
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 2 || strings.HasPrefix(line, "List ") || strings.HasPrefix(line, "*") {
			continue
		}
		if !slices.Contains([]string{"device", "unauthorized", "offline", "recovery", "sideload", "bootloader"}, f[1]) {
			continue
		}
		d := device{Serial: f[0], State: f[1]}
		for _, p := range f[2:] {
			if strings.HasPrefix(p, "model:") {
				d.Model = strings.ReplaceAll(strings.TrimPrefix(p, "model:"), "_", " ")
			}
		}
		list = append(list, d)
	}
	return list, nil
}
func (c *controller) requireDevice(serial string) error {
	if serial == "" {
		return errors.New("请先选择手机")
	}
	list, err := c.devices()
	if err != nil {
		return err
	}
	for _, d := range list {
		if d.Serial == serial {
			if d.State == "device" {
				return nil
			}
			return fmt.Errorf("手机状态为 %s，请解锁手机并允许 USB 调试", d.State)
		}
	}
	return errors.New("没有找到这台手机，请连接数据线并开启 USB 调试")
}
func (c *controller) probe(serial string) (map[string]string, error) {
	if err := c.requireDevice(serial); err != nil {
		return nil, err
	}
	help, err := c.shell(serial, "cmd", "location", "help")
	if err != nil {
		return nil, err
	}
	for _, name := range []string{"add-test-provider", "remove-test-provider", "set-test-provider-location"} {
		if !strings.Contains(help, name) {
			return nil, errors.New("当前系统未提供完整的 ADB 测试定位接口")
		}
	}
	info := map[string]string{"interface": "系统提供测试定位接口；能否注入坐标仍需实际应用位置验证"}
	for name, prop := range map[string]string{"model": "ro.product.model", "android": "ro.build.version.release", "sdk": "ro.build.version.sdk", "hyperos": "ro.mi.os.version.name"} {
		v, e := c.shell(serial, "getprop", prop)
		if e != nil {
			return nil, e
		}
		info[name] = v
	}
	return info, nil
}
func (c *controller) save() error {
	if c.current == nil {
		err := os.Remove(c.journal)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	data, err := json.MarshalIndent(c.current, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(c.journal), 0700); err != nil {
		return err
	}
	if err = os.WriteFile(c.journal+".tmp", data, 0600); err != nil {
		return err
	}
	return os.Rename(c.journal+".tmp", c.journal)
}
func (c *controller) load() error {
	data, err := os.ReadFile(c.journal)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var s session
	if err = json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("恢复记录损坏：%w", err)
	}
	if s.Serial == "" || !slices.Contains([]string{"allow", "ignore", "deny", "default", "foreground"}, s.PreviousMode) {
		return errors.New("恢复记录不合法，请保留文件并检查")
	}
	for _, p := range s.Providers {
		if p != "gps" && p != "network" {
			return errors.New("恢复记录中的定位源不合法")
		}
	}
	c.current = &s
	c.lastError = "上次会话未完成恢复。请连接原来的手机，点击「恢复真实定位」后再使用。"
	return nil
}
func parseMode(out string) (string, error) {
	if strings.Contains(out, "No operations") {
		return "default", nil
	}
	re := regexp.MustCompile(`(?i)MOCK_LOCATION:\s*(allow|ignore|deny|default|foreground)\b`)
	m := re.FindAllStringSubmatch(out, -1)
	if len(m) == 0 {
		return "", errors.New("无法读取原有模拟定位权限，尚未修改手机")
	}
	mode := strings.ToLower(m[0][1])
	for _, row := range m {
		if strings.ToLower(row[1]) != mode {
			return "", errors.New("模拟定位权限存在多个不同状态，尚未修改手机")
		}
	}
	return mode, nil
}
func validatePosition(p position) error {
	if p.Latitude == nil || p.Longitude == nil {
		return errors.New("请填写纬度和经度")
	}
	lat, lon := *p.Latitude, *p.Longitude
	if math.IsNaN(lat) || math.IsNaN(lon) || math.IsInf(lat, 0) || math.IsInf(lon, 0) || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		return errors.New("纬度应在 -90～90，经度应在 -180～180")
	}
	return nil
}
func (c *controller) injectLocked() error {
	s := c.current
	coord := strconv.FormatFloat(s.Latitude, 'f', 7, 64) + "," + strconv.FormatFloat(s.Longitude, 'f', 7, 64)
	for _, p := range s.Providers {
		if _, err := c.shell(s.Serial, "cmd", "location", "providers", "set-test-provider-location", p, "--location", coord, "--accuracy", "5"); err != nil {
			return err
		}
	}
	c.lastRefresh = time.Now().Format(time.RFC3339)
	return nil
}
func (c *controller) set(p position) error {
	if err := validatePosition(p); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.current != nil && !c.active {
		return errors.New("存在待恢复会话，请先点击「恢复真实定位」")
	}
	if err := c.requireDevice(p.Serial); err != nil {
		return err
	}
	providers := []string{"gps"}
	if p.Network {
		providers = append(providers, "network")
	}
	if c.current != nil {
		if c.current.Serial != p.Serial || !slices.Equal(c.current.Providers, providers) {
			return errors.New("请先恢复真实定位，再更换手机或定位源")
		}
		c.current.Latitude = *p.Latitude
		c.current.Longitude = *p.Longitude
		if err := c.save(); err != nil {
			return err
		}
		if err := c.injectLocked(); err != nil {
			c.active = false
			c.lastError = err.Error()
			return err
		}
		c.lastError = ""
		return nil
	}
	if _, err := c.probe(p.Serial); err != nil {
		return err
	}
	enabled, err := c.shell(p.Serial, "cmd", "location", "is-location-enabled")
	if err != nil {
		return err
	}
	if strings.TrimSpace(enabled) != "true" {
		return errors.New("请先在手机设置中开启位置信息")
	}
	dump, err := c.shell(p.Serial, "dumpsys", "location")
	if err != nil {
		return err
	}
	if regexp.MustCompile(`(?i)last mock location=|mock provider|mocklocationprovider|mock\s*=\s*true`).MatchString(dump) {
		return errors.New("检测到已有模拟定位源，请先停止其他模拟定位工具")
	}
	op, err := c.shell(p.Serial, "appops", "get", "2000", "android:mock_location")
	if err != nil {
		return err
	}
	mode, err := parseMode(op)
	if err != nil {
		return err
	}
	c.current = &session{Serial: p.Serial, Providers: []string{}, PreviousMode: mode, Latitude: *p.Latitude, Longitude: *p.Longitude}
	if err = c.save(); err != nil {
		c.current = nil
		return err
	}
	initialize := func() error {
		if _, e := c.shell(p.Serial, "appops", "set", "2000", "android:mock_location", "allow"); e != nil {
			return e
		}
		check, e := c.shell(p.Serial, "appops", "get", "2000", "android:mock_location")
		if e != nil {
			return e
		}
		actual, e := parseMode(check)
		if e != nil {
			return e
		}
		if actual != "allow" {
			return errors.New("系统未允许 ADB 模拟定位权限，当前 HyperOS 可能限制了该功能")
		}
		for _, provider := range providers {
			// Record intent before creating a provider, so interruption remains recoverable.
			c.current.Providers = append(c.current.Providers, provider)
			if e = c.save(); e != nil {
				return e
			}
			if _, e = c.shell(p.Serial, "cmd", "location", "providers", "add-test-provider", provider); e != nil {
				return e
			}
			if _, e = c.shell(p.Serial, "cmd", "location", "providers", "set-test-provider-enabled", provider, "true"); e != nil {
				return e
			}
		}
		return c.injectLocked()
	}
	if err = initialize(); err != nil {
		cleanup := c.resetLocked()
		c.lastError = err.Error()
		if cleanup != nil {
			c.lastError += "；恢复未完成：" + cleanup.Error()
		}
		return errors.New(c.lastError)
	}
	c.active = true
	c.lastError = ""
	return nil
}
func (c *controller) resetLocked() error {
	c.active = false
	if c.current == nil {
		c.lastError = ""
		return nil
	}
	s := c.current
	if err := c.requireDevice(s.Serial); err != nil {
		c.lastError = "恢复未完成：" + err.Error()
		return errors.New(c.lastError)
	}
	for len(s.Providers) > 0 {
		provider := s.Providers[len(s.Providers)-1]
		if _, err := c.shell(s.Serial, "cmd", "location", "providers", "remove-test-provider", provider); err != nil {
			c.lastError = "恢复未完成：" + err.Error()
			return errors.New(c.lastError)
		}
		s.Providers = s.Providers[:len(s.Providers)-1]
		if err := c.save(); err != nil {
			return err
		}
	}
	if _, err := c.shell(s.Serial, "appops", "set", "2000", "android:mock_location", s.PreviousMode); err != nil {
		c.lastError = "恢复权限未完成：" + err.Error()
		return errors.New(c.lastError)
	}
	check, err := c.shell(s.Serial, "appops", "get", "2000", "android:mock_location")
	if err != nil {
		return err
	}
	mode, err := parseMode(check)
	if err != nil {
		return err
	}
	if mode != s.PreviousMode {
		return errors.New("系统没有恢复原有权限，请保持连接并重试")
	}
	c.current = nil
	if err = c.save(); err != nil {
		c.current = s
		return err
	}
	c.lastError = ""
	c.lastRefresh = ""
	return nil
}
func (c *controller) reset() error { c.mu.Lock(); defer c.mu.Unlock(); return c.resetLocked() }
func (c *controller) refresh(ctx context.Context) {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.mu.Lock()
			if c.active {
				if err := c.injectLocked(); err != nil {
					c.active = false
					c.lastError = "定位刷新已停止：" + err.Error() + "。重新连接后请先恢复真实定位。"
				}
			}
			c.mu.Unlock()
		}
	}
}
func (c *controller) status() map[string]any {
	list, err := c.devices()
	c.mu.Lock()
	defer c.mu.Unlock()
	var s *session
	if c.current != nil {
		copy := *c.current
		copy.Providers = append([]string{}, c.current.Providers...)
		s = &copy
	}
	result := map[string]any{"devices": list, "session": s, "active": c.active, "error": c.lastError, "last_refresh": c.lastRefresh}
	if err != nil {
		result["device_error"] = err.Error()
	}
	return result
}
func respond(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return errors.New("请求需为 JSON")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return fmt.Errorf("无效请求：%w", err)
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return errors.New("请求只能包含一个 JSON 对象")
	}
	return nil
}
func handler(c *controller, host, token string, stop func()) http.Handler {
	static, _ := fs.Sub(assets, "web")
	files := http.FileServer(http.FS(static))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
		if r.Host != host {
			respond(w, 403, map[string]string{"error": "仅允许本机访问"})
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+host {
			respond(w, 403, map[string]string{"error": "拒绝跨站请求"})
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			if r.Method != "GET" && r.Method != "HEAD" {
				w.WriteHeader(405)
				return
			}
			files.ServeHTTP(w, r)
			return
		}
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Session-Token")), []byte(token)) != 1 {
			respond(w, 401, map[string]string{"error": "会话已过期，请重新启动工具打开网页"})
			return
		}
		if r.URL.Path == "/api/status" {
			if r.Method != "GET" {
				w.WriteHeader(405)
				return
			}
			respond(w, 200, c.status())
			return
		}
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		var err error
		var result any = map[string]bool{"ok": true}
		switch r.URL.Path {
		case "/api/probe":
			var body struct {
				Serial string `json:"serial"`
			}
			err = decode(w, r, &body)
			if err == nil {
				result, err = c.probe(body.Serial)
			}
		case "/api/location/set":
			var p position
			err = decode(w, r, &p)
			if err == nil {
				err = c.set(p)
			}
		case "/api/location/reset", "/api/shutdown":
			var body struct{}
			err = decode(w, r, &body)
			if err == nil {
				err = c.reset()
			}
			if err == nil && r.URL.Path == "/api/shutdown" {
				defer stop()
			}
		default:
			respond(w, 404, map[string]string{"error": "接口不存在"})
			return
		}
		if err != nil {
			respond(w, 400, map[string]string{"error": err.Error()})
			return
		}
		respond(w, 200, result)
	})
}
func main() {
	exe, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	root := filepath.Dir(exe)
	adb := flag.String("adb", filepath.Join(root, "platform-tools", "adb"), "ADB 路径")
	port := flag.Int("port", 8765, "本机网页端口")
	noOpen := flag.Bool("no-open", false, "不自动打开浏览器")
	printURL := flag.Bool("print-url", false, "打印带凭证的本机 URL（仅供本地调试）")
	state := flag.String("state", filepath.Join(root, ".runtime", "session.json"), "恢复记录路径")
	flag.Parse()
	if _, err = os.Stat(*adb); err != nil {
		log.Fatal("找不到 ADB，请将 platform-tools 文件夹放在启动程序旁边。")
	}
	if err = os.MkdirAll(filepath.Dir(*state), 0700); err != nil {
		log.Fatal(err)
	}
	lock, err := os.OpenFile(filepath.Join(filepath.Dir(*state), "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		log.Fatal(err)
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		log.Fatal("工具已经在运行，请回到原来的网页。")
	}
	c := &controller{run: adbRunner(*adb), journal: *state}
	if err = c.load(); err != nil {
		log.Fatal(err)
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		log.Fatal("网页端口被占用，请关闭已经运行的工具。")
	}
	host := listener.Addr().String()
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		log.Fatal(err)
	}
	token := hex.EncodeToString(b)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.refresh(ctx)
	stop := make(chan struct{}, 1)
	done := func() {
		select {
		case stop <- struct{}{}:
		default:
		}
	}
	server := &http.Server{Handler: handler(c, host, token, done), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Print(err)
			done()
		}
	}()
	url := "http://" + host + "/#" + token
	fmt.Println("本地定位工具已启动：http://" + host)
	fmt.Println("请保持手机连接。网页可切换位置、恢复定位，并安全退出。")
	if *printURL {
		fmt.Println(url)
	}
	if !*noOpen {
		if err = exec.Command("open", url).Run(); err != nil {
			fmt.Println("无法自动打开浏览器。请重新双击启动，或检查默认浏览器设置。")
		}
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	select {
	case <-sig:
	case <-stop:
	}
	cancel()
	if err = c.reset(); err != nil {
		fmt.Println("恢复尚未完成：", err, "。恢复记录已保留，下次启动可重试。")
	}
	shutdown, cancelShutdown := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancelShutdown()
	_ = server.Shutdown(shutdown)
}
