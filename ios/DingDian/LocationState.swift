import SwiftUI
import MapKit
import CoreLocation

@MainActor
final class LocationState: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    @Published var selected = Coordinate.initial
    @Published var hasSelection = false
    @Published var locating = false
    @Published var latitude = ""
    @Published var longitude = ""
    @Published var query = ""
    @Published var results: [MKMapItem] = []
    @Published var busy = false
    @Published var active = false
    @Published var needsRecovery = false
    @Published var message = "实验版：尚未完成 iPhone 实机验证。"
    @Published var showSetup = false
    let pairing = PairingService()
    private var applied: Coordinate?
    private var refreshTask: Task<Void, Never>?
    private var searchRequest: MKLocalSearch?
    private var searchGeneration = UUID()

    private lazy var currentManager: CLLocationManager = {
        let manager = CLLocationManager(); manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        return manager
    }()
    private var currentGeneration: UUID?
    private var currentFields = ("", "")
    private var locationTimeout: Task<Void, Never>?

    override init() {
        super.init()
        do {
            if try recoveryJournal().pending {
                needsRecovery = true
                message = "上次会话状态未知，请连接本机 VPN 后先恢复真实定位。"
            }
        } catch { needsRecovery = true; message = AuroraLocationError.storageFailed.localizedDescription }
    }
    private func recoveryJournal() throws -> RecoveryJournal { RecoveryJournal(url: try LocalStore.directory("Recovery").appendingPathComponent("session.json")) }
    func select(_ coordinate: Coordinate) {
        guard coordinate.isValid else { return }
        hasSelection = true
        selected = coordinate
        latitude = String(format: "%.6f", coordinate.latitude)
        longitude = String(format: "%.6f", coordinate.longitude)
    }
    func requestCurrentLocation() {
        guard !locating, !needsRecovery, !active else {
            if needsRecovery || active { message = "请先恢复真实定位，再获取当前位置。" }
            return
        }
        locating = true
        let generation = UUID(); currentGeneration = generation
        currentFields = (latitude, longitude)
        message = "正在获取当前真实位置…"
        locationTimeout = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(18)) } catch { return }
            guard let self, self.currentGeneration == generation else { return }
            self.finishCurrentLocation("暂未获取当前位置，请重试或手动选点。")
        }
        switch currentManager.authorizationStatus {
        case .notDetermined: currentManager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse: currentManager.requestLocation()
        default: finishCurrentLocation("请在系统设置中允许定点使用位置信息。")
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard locating else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: manager.requestLocation()
        case .denied, .restricted: finishCurrentLocation("未允许定位，可在系统设置中授权或手动选点。")
        default: break
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard locating, !needsRecovery, !active else { return }
        guard let fix = locations.last, fix.horizontalAccuracy >= 0,
              abs(fix.timestamp.timeIntervalSinceNow) <= 15,
              fix.sourceInformation?.isSimulatedBySoftware != true else {
            finishCurrentLocation("未获取到新的真实位置，请重试或手动选点。")
            return
        }
        guard latitude == currentFields.0, longitude == currentFields.1 else {
            finishCurrentLocation(nil); return
        }
        select(Coordinate(latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude))
        finishCurrentLocation("已获取当前真实位置，精度约 \(Int(fix.horizontalAccuracy)) 米。尚未启用模拟定位。")
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if locating { finishCurrentLocation("当前位置获取失败，请检查系统定位权限后重试。") }
    }
    func finishCurrentLocation(_ text: String?) {
        locating = false; currentGeneration = nil
        locationTimeout?.cancel(); locationTimeout = nil
        currentManager.stopUpdatingLocation()
        if let text { message = text }
    }
    func search() async {
        searchRequest?.cancel()
        let generation = UUID(); searchGeneration = generation
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { results = []; return }
        let parts = trimmed.replacingOccurrences(of: "，", with: ",").split(separator: ",", omittingEmptySubsequences: false)
        if parts.count == 2, let lat = Double(parts[0].trimmingCharacters(in: .whitespaces)),
           let lon = Double(parts[1].trimmingCharacters(in: .whitespaces)) {
            let coordinate = Coordinate(latitude: lat, longitude: lon)
            guard coordinate.isValid else { message = AuroraLocationError.invalidCoordinate.localizedDescription; return }
            select(coordinate); results = []; message = "坐标已选中，点击应用位置后才会生效。"; return
        }
        let request = MKLocalSearch.Request(); request.naturalLanguageQuery = trimmed
        let search = MKLocalSearch(request: request); searchRequest = search
        do {
            let response = try await search.start()
            guard searchGeneration == generation else { return }
            results = Array(response.mapItems.prefix(6))
            message = results.isEmpty ? "未找到地点，请输入更完整的地址或坐标。" : "请选择一个搜索结果。"
        } catch { if searchGeneration == generation { message = "搜索失败，请检查网络或直接输入坐标。" } }
    }
    func execute(_ command: LocationCommand) async {
        guard !busy, !pairing.isBusy else { return }
        guard #available(iOS 27.0, *) else { message = "本机配对路线需要 iOS 27+，当前系统未适配。"; return }
        pairing.refresh()
        guard pairing.hasPairing else { message = AuroraLocationError.pairingMissing.localizedDescription; showSetup = true; return }
        if case .set(let coordinate) = command {
            guard coordinate.isValid else { message = AuroraLocationError.invalidCoordinate.localizedDescription; return }
            guard !needsRecovery || active else { message = "请先恢复上次会话，再应用新位置。"; return }
            do {
                // Persist the recovery intent before sending any developer command.
                try recoveryJournal().record(coordinate)
                needsRecovery = true
            } catch { message = AuroraLocationError.storageFailed.localizedDescription; return }
        }
        finishCurrentLocation(nil)
        busy = true; refreshTask?.cancel(); refreshTask = nil
        message = "正在连接本机开发者服务并发送指令…"
        defer { busy = false }
        do {
            try await LocationEngine.perform(command, pairingPath: PairingStore.fileURL().path)
            switch command {
            case .set(let coordinate):
                active = true; applied = coordinate
                message = "设置指令已发送。请在 Apple 地图核对实际位置；后台保持未验证。"
                startRefresh()
            case .clear:
                active = false; applied = nil
                try recoveryJournal().finish()
                needsRecovery = false
                message = "恢复指令已发送。请在 Apple 地图等待并核对真实位置。"
            }
        } catch {
            active = false; applied = nil
            message = error.localizedDescription + " 恢复记录已保留。"
        }
    }
    private func startRefresh() {
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(4)) } catch { return }
                guard let self, self.active, let coordinate = self.applied, !self.busy else { return }
                self.busy = true
                do { try await LocationEngine.perform(.set(coordinate), pairingPath: PairingStore.fileURL().path) }
                catch {
                    self.active = false
                    self.message = "持续提交已停止，系统状态未知。请先恢复真实定位。"
                }
                self.busy = false
                if !self.active { return }
            }
        }
    }
}
