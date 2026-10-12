import SwiftUI
import MapKit

@main
struct DingDianApp: App {
    @StateObject private var state = LocationState()
    @AppStorage("theme") private var theme = "system"
    var body: some Scene {
        WindowGroup {
            WorkspaceView(state: state)
                .tint(Color(red: 0.55, green: 0.48, blue: 0.97))
                .preferredColorScheme(theme == "dark" ? .dark : theme == "light" ? .light : nil)
                .onOpenURL { url in
                    // Links only open the workspace. They never apply or clear coordinates.
                    if !LaunchLink.accepts(url) { state.message = "不支持的链接，未执行定位操作。" }
                }
        }
    }
}

struct WorkspaceView: View {
    @ObservedObject var state: LocationState
    @Environment(\.colorScheme) private var colorScheme
    @State private var mapSpan = MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
    @State private var camera: MapCameraPosition = .automatic
    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                HStack {
                    TextField("搜索地点或纬度,经度", text: $state.query).textInputAutocapitalization(.never)
                        .onSubmit { Task { await state.search() } }
                    Button("搜索") { Task { await state.search() } }
                }.padding(.horizontal)
                if !state.results.isEmpty {
                    ScrollView {
                        VStack(alignment: .leading) {
                            ForEach(Array(state.results.enumerated()), id: \.offset) { _, item in
                                Button {
                                    state.select(Coordinate(latitude: item.placemark.coordinate.latitude, longitude: item.placemark.coordinate.longitude))
                                    state.results = []
                                } label: { VStack(alignment: .leading) {
                                    Text(item.name ?? "未命名地点")
                                    Text(item.placemark.title ?? "").font(.caption).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading).padding(6) }
                            }
                        }
                    }.frame(maxHeight: 140).padding(.horizontal)
                }
                MapReader { proxy in
                    Map(position: $camera) {
                        if state.hasSelection {
                            Marker("目标位置", coordinate: CLLocationCoordinate2D(latitude: state.selected.latitude, longitude: state.selected.longitude))
                        }
                    }
                    .onMapCameraChange(frequency: .onEnd) { context in mapSpan = context.region.span }
                    .onTapGesture { point in
                        if let coordinate = proxy.convert(point, from: .local) { state.select(Coordinate(latitude: coordinate.latitude, longitude: coordinate.longitude)) }
                    }
                }.clipShape(RoundedRectangle(cornerRadius: 16)).padding(.horizontal)
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text(state.hasSelection ? "目标坐标 · WGS84" : "等待当前位置").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button(state.locating ? "定位中…" : "当前位置") { state.requestCurrentLocation() }
                            .disabled(state.locating || state.needsRecovery || state.active)
                    }
                    HStack {
                        TextField("纬度", text: $state.latitude).keyboardType(.numbersAndPunctuation).accessibilityLabel("纬度")
                        TextField("经度", text: $state.longitude).keyboardType(.numbersAndPunctuation).accessibilityLabel("经度")
                    }.textFieldStyle(.roundedBorder)
                    Text(state.message).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    HStack {
                        Button("应用位置") {
                            guard let lat = Double(state.latitude), let lon = Double(state.longitude) else { state.message = AuroraLocationError.invalidCoordinate.localizedDescription; return }
                            let coordinate = Coordinate(latitude: lat, longitude: lon)
                            state.select(coordinate)
                            Task { await state.execute(.set(coordinate)) }
                        }.buttonStyle(.borderedProminent).disabled(state.busy || state.pairing.isBusy || (state.needsRecovery && !state.active))
                        Button("恢复真实定位") { Task { await state.execute(.clear) } }.buttonStyle(.bordered).disabled(state.busy || state.pairing.isBusy)
                    }
                }.padding().background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16)).padding(.horizontal)
            }
            .background(colorScheme == .dark ? Color(red: 0.078, green: 0.078, blue: 0.086) : Color(red: 0.969, green: 0.969, blue: 0.973))
            .padding(.bottom).navigationTitle("定点 · iOS 实验版").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("设备设置", systemImage: "gearshape") { state.showSetup = true } }
            .task { if !state.hasSelection && !state.needsRecovery { state.requestCurrentLocation() } }
            .sheet(isPresented: $state.showSetup) { SetupView(pairing: state.pairing, canPair: !state.needsRecovery && !state.busy) }
            .onChange(of: state.selected) { _, coordinate in
                camera = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude), span: mapSpan))
            }
        }
    }
}

struct SetupView: View {
    @ObservedObject var pairing: PairingService
    let canPair: Bool
    @AppStorage("theme") private var theme = "system"
    @Environment(\.dismiss) private var dismiss
    private var licenseText: String {
        guard let url = Bundle.main.url(forResource: "THIRD_PARTY_LICENSES", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else {
            return "许可证读取失败，请查看项目 ios/THIRD_PARTY_LICENSES.txt。"
        }
        return text
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("外观") {
                    Picker("主题", selection: $theme) {
                        Text("跟随系统").tag("system")
                        Text("深色").tag("dark")
                        Text("浅色").tag("light")
                    }
                }
                Section("支持条件") {
                    Text("面向 iPhone 16 及后续机型、iOS 27+。尚未完成本项目的真机验证。")
                    Text("需自行签名侧载、启用开发者模式、允许本地网络和通知，并连接 Wi-Fi。普通网页或 App Store 安装无法提供整机定位修改权限。")
                    Link("LocalDevVPN 项目与安装入口", destination: URL(string: "https://github.com/jkcoxson/LocalDevVPN")!)
                    Text("连接 LocalDevVPN 后操作。与其他 VPN 的共存、蜂窝网络及长期后台保持尚未验证。开发者定位服务若不可用，仍可能需要电脑准备设备。")
                }
                Section("本机配对") {
                    Text(pairing.status)
                    if let pin = pairing.pin { Text(pin).font(.largeTitle.monospacedDigit()).accessibilityLabel("配对验证码 " + pin) }
                    Text("点开始后，在系统设置 → 隐私与安全性 → 开发者模式 → Pair with Host 中选择「定点 iOS」，按提示输入锁屏密码及六位验证码。")
                    if pairing.isBusy { Button("取消配对", role: .destructive) { pairing.cancel() } }
                    else { Button(pairing.hasPairing ? "重新配对" : "开始配对") { pairing.start() }.disabled(!canPair) }
                    if !canPair { Text("请先恢复真实定位，再重新配对。") }
                }
                Section("恢复与更新") {
                    Text("同时只使用一个模拟定位工具，先恢复原工具的定位再切换。")
                    Text("结束时必须点击恢复真实定位。关闭 App、锁屏或连接断开后，系统状态可能变化；重新打开先处理待恢复会话。链接只打开页面。")
                    Text("iOS 更新需下载新 IPA，沿用同一签名与应用标识覆盖安装，无法使用 Android 的 APK 更新流程。")
                    Link("查看项目 Release", destination: URL(string: "https://github.com/Yuanmy621/IP-change/releases")!)
                    NavigationLink("第三方许可证") {
                        ScrollView {
                            Text(licenseText)
                                .font(.caption).padding().textSelection(.enabled)
                        }.navigationTitle("第三方许可证")
                    }
                }
            }.navigationTitle("设备设置").toolbar { Button("完成") { dismiss() }.disabled(pairing.isBusy) }
        }.interactiveDismissDisabled(pairing.isBusy)
    }
}
