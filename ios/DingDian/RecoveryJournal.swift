import Foundation

// Any existing record, including an unreadable one, requires explicit recovery.
// The caller deletes the record only after the developer clear command succeeds.
struct RecoveryJournal {
    let url: URL
    var pending: Bool { FileManager.default.fileExists(atPath: url.path) }
    func record(_ coordinate: Coordinate) throws {
        guard coordinate.isValid else { throw AuroraLocationError.invalidCoordinate }
        var options: Data.WritingOptions = [.atomic]
        #if os(iOS)
        options.insert(.completeFileProtection)
        #endif
        try JSONEncoder().encode(coordinate).write(to: url, options: options)
    }
    func finish() throws {
        if pending { try FileManager.default.removeItem(at: url) }
    }
}
