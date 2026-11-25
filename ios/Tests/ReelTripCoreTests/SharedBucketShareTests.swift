import XCTest
@testable import ReelTripCore

// Week 5: sharing a reel from Instagram/TikTok straight into a shared bucket.
final class SharedBucketShareTests: XCTestCase {
    private func store() throws -> (SharedInbox, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        return (try SharedInbox(directory: directory), directory)
    }
    func testSharedBucketListIsValidatedAndPersisted() throws {
        let (inbox, directory) = try store(); defer { try? FileManager.default.removeItem(at: directory) }
        XCTAssertEqual(try inbox.sharedBuckets(), [])
        let lisbon = SharedBucketChoice(id: UUID().uuidString.lowercased(), name: "Lisbon in May")
        try inbox.replaceSharedBuckets([lisbon])
        XCTAssertEqual(try SharedInbox(directory: directory).sharedBuckets(), [lisbon])
        for bad in [[SharedBucketChoice(id: "not-a-uuid", name: "x")], [SharedBucketChoice(id: UUID().uuidString, name: " ")],
                    [SharedBucketChoice(id: UUID().uuidString, name: String(repeating: "a", count: 81))],
                    [SharedBucketChoice(id: UUID().uuidString, name: "a\u{0007}b")], [lisbon, lisbon]] {
            XCTAssertThrowsError(try inbox.replaceSharedBuckets(bad))
        }
        XCTAssertEqual(try inbox.sharedBuckets(), [lisbon], "a rejected list leaves the old one")
    }
    func testShareToSharedBucketQueuesForTheApp() throws {
        let (inbox, directory) = try store(); defer { try? FileManager.default.removeItem(at: directory) }
        let id = UUID().uuidString.lowercased()
        let url = try XCTUnwrap(URL(string: "https://www.instagram.com/reel/DeSbT_lEZGL/"))
        XCTAssertThrowsError(try inbox.share([url], to: nil, openAnalysis: false, sharedBucketId: id), "an unknown bucket is refused")
        try inbox.replaceSharedBuckets([SharedBucketChoice(id: id, name: "Lisbon")])
        let action = try inbox.share([url], to: nil, openAnalysis: false, sharedBucketId: id)
        XCTAssertEqual(action.sharedBucketId, id)
        let pending = try inbox.pendingShares()
        XCTAssertEqual(pending.count, 1); XCTAssertEqual(pending.first?.sharedBucketId, id); XCTAssertNil(pending.first?.bundleId)
        XCTAssertEqual(try inbox.videos().map(\.url), [url], "the reel is also kept in the Reel Library")
        try inbox.acknowledgeShares([action.id])
        XCTAssertTrue(try inbox.pendingShares().isEmpty)
    }
    func testOlderActionsWithoutASharedBucketStillDecode() throws {
        let (inbox, directory) = try store(); defer { try? FileManager.default.removeItem(at: directory) }
        let url = try XCTUnwrap(URL(string: "https://www.instagram.com/reel/abc/"))
        let action = try inbox.share([url], to: nil)
        XCTAssertNil(action.sharedBucketId)
        let folder = directory.appendingPathComponent("share-actions")
        let file = folder.appendingPathComponent(action.id + ".json")
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        json.removeValue(forKey: "sharedBucketId")
        try JSONSerialization.data(withJSONObject: json).write(to: file)
        XCTAssertEqual(try inbox.pendingShares().map(\.id), [action.id], "0.3.0 share files are still read")
        json["sharedBucketId"] = "not-a-uuid"
        try JSONSerialization.data(withJSONObject: json).write(to: file)
        XCTAssertTrue(try inbox.pendingShares().isEmpty, "a tampered bucket id is ignored")
    }
}
