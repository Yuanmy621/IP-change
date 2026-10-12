import Foundation

struct Coordinate: Codable, Equatable, Sendable {
    let latitude: Double
    let longitude: Double
    var isValid: Bool {
        latitude.isFinite && longitude.isFinite && (-90...90).contains(latitude) && (-180...180).contains(longitude)
    }
    var label: String { String(format: "%.6f, %.6f", latitude, longitude) }
    // Neutral internal value; not displayed as a selected location.
    static let initial = Coordinate(latitude: 0, longitude: 0)
}

enum LaunchLink {
    static func accepts(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return parts.scheme?.lowercased() == "dingdian-ios" && parts.host == "open"
            && parts.path.isEmpty && parts.query == nil && parts.fragment == nil
            && parts.user == nil && parts.password == nil && parts.port == nil
    }
}

enum LocationCommand: Sendable { case set(Coordinate), clear }

enum AuroraLocationError: String, LocalizedError, Sendable {
    case invalidCoordinate, pairingMissing, pairingInvalid, pairingFailed, pairingCancelled, pairingSaveFailed
    case wifiRequired, tunnelUnavailable, dvtConnectionFailed, developerImageUnavailable
    case locationSimulationFailed, clearSimulationFailed, storageFailed
    var errorDescription: String? {
        switch self {
        case .invalidCoordinate: return "坐标无效。纬度范围 -90～90，经度范围 -180～180。"
        case .pairingMissing: return "请先在设备设置中配对这台 iPhone。"
        case .pairingInvalid: return "配对记录无法读取，请解锁手机后重试。"
        case .pairingFailed: return "配对失败，请检查本地网络权限、Wi-Fi 和开发者模式。"
        case .pairingCancelled: return "配对已取消或系统后台时间已到，请返回页面重试。"
        case .pairingSaveFailed: return "配对记录保存失败，请保留原数据并解锁后重试。"
        case .wifiRequired: return "本机配对需要先连接 Wi-Fi。"
        case .tunnelUnavailable: return "本机开发者连接不可用。请连接 LocalDevVPN、保持 Wi-Fi，并允许本地网络访问。"
        case .dvtConnectionFailed: return "开发者服务连接失败，请检查开发者模式与配对。"
        case .developerImageUnavailable: return "LocationSimulation 服务不可用，可能需要电脑准备开发者镜像。该设备尚不能确认完全脱离电脑。"
        case .locationSimulationFailed: return "设置指令失败，系统定位状态未知，请尝试恢复真实定位。"
        case .clearSimulationFailed: return "恢复指令失败，系统定位状态未知，请保持 VPN 和 Wi-Fi 后重试。"
        case .storageFailed: return "恢复记录无法保存，已停止操作。"
        }
    }
}
