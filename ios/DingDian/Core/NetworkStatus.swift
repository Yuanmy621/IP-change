import Foundation
import Darwin

enum NetworkStatus {
    // LocalDevVPN routes this address back to the same phone's developer services.
    static let tunnelIP = "10.7.0.1"
    static var hasWiFiAddress: Bool {
        var addresses: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&addresses) == 0 else { return false }
        defer { freeifaddrs(addresses) }
        var current = addresses
        while let entry = current {
            let item = entry.pointee
            if String(cString: item.ifa_name) == "en0",
               item.ifa_flags & UInt32(IFF_UP | IFF_RUNNING) == UInt32(IFF_UP | IFF_RUNNING),
               let address = item.ifa_addr,
               [sa_family_t(AF_INET), sa_family_t(AF_INET6)].contains(address.pointee.sa_family) { return true }
            current = item.ifa_next
        }
        return false
    }
}
