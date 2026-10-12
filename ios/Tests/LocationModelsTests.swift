import Foundation

@main struct LocationModelsTests {
    static func main() {
        for value in [Coordinate.initial, Coordinate(latitude: -90, longitude: 180), Coordinate(latitude: 90, longitude: -180)] {
            precondition(value.isValid)
            precondition((try! JSONDecoder().decode(Coordinate.self, from: JSONEncoder().encode(value))) == value)
        }
        for value in [Coordinate(latitude: .nan, longitude: 0), Coordinate(latitude: 0, longitude: .infinity), Coordinate(latitude: 91, longitude: 0), Coordinate(latitude: 0, longitude: -181)] {
            precondition(!value.isValid)
        }
        precondition(LaunchLink.accepts(URL(string: "dingdian-ios://open")!))
        for link in ["dingdian://open", "dingdian-ios://set?lat=0&lon=0", "dingdian-ios://open?lat=0", "dingdian-ios://open#clear", "dingdian-ios://open/extra", "dingdian-ios://user@open", "dingdian-ios://open:8765", "https://open"] {
            precondition(!LaunchLink.accepts(URL(string: link)!))
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let journal = RecoveryJournal(url: directory.appendingPathComponent("session.json"))
        precondition(!journal.pending)
        try! journal.record(.initial)
        precondition(journal.pending)
        let before = try! Data(contentsOf: journal.url)
        do { try journal.record(Coordinate(latitude: .nan, longitude: 0)); preconditionFailure("Invalid coordinate was saved") }
        catch { precondition((try! Data(contentsOf: journal.url)) == before) }
        let reopened = RecoveryJournal(url: journal.url)
        precondition(reopened.pending)
        try! Data("corrupt".utf8).write(to: journal.url)
        precondition(reopened.pending) // Corrupt records must never be silently discarded.
        try! reopened.finish()
        precondition(!reopened.pending)
        do {
            try RecoveryJournal(url: directory.appendingPathComponent("missing/session.json")).record(.initial)
            preconditionFailure("Saving to a missing parent should fail")
        } catch { }
        print("iOS 坐标、链接和恢复记录检查通过；不包含真机协议验收。")
    }
}
