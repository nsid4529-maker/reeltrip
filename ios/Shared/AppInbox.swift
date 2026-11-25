import Foundation
enum AppInbox {
    static func open() throws -> SharedInbox {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "ReelTripAppGroup") as? String,
              !group.isEmpty,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { throw ShareFailure.unavailable }
        return try SharedInbox(directory: container.appendingPathComponent("ReelTripInbox", isDirectory: true))
    }
}
