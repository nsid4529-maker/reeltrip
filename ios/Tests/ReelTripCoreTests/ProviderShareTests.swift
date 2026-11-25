import XCTest
@testable import ReelTripCore

final class ProviderShareTests: XCTestCase {
    private let activity = "https://www.getyourguide.com/en-gb/amsterdam-l36/amsterdam-light-festival-cruise-t907734"
    private let hotel = "https://www.booking.com/hotel/gb/the-ivy.en-gb.html"

    func testIndividualProductPagesAndKinds() throws {
        let cases = [
            ("https://viator.com/tours/Amsterdam/Canal-Cruise/d525-123P1/", "Viator", "activity"),
            (activity, "GetYourGuide", "activity"),
            (hotel, "Booking.com", "hotel"),
            ("https://expedia.co.uk/London-Hotels-Park-Plaza.h123456.Hotel-Information", "Expedia", "hotel"),
            ("https://www.opentable.co.uk/r/the-ivy-in-the-park-london", "OpenTable", "restaurant"),
            ("https://www.sevenrooms.com/explore/oudh1722/reservations/create/search", "SevenRooms", "restaurant")
        ]
        for (raw, provider, kind) in cases {
            let link = try ProviderLinkParser.parse(XCTUnwrap(URL(string: raw)))
            XCTAssertEqual(link.provider, provider)
            XCTAssertEqual(link.kind, kind)
            XCTAssertTrue(link.url.host?.hasPrefix("www.") == true)
        }
    }

    func testCanonicalizesSharedCaptionAndTracking() throws {
        let links = try ProviderLinkParser.links(in: ["Try this \(activity)/?date_from=2026-12-22&ranking_uuid=abc#details", activity])
        XCTAssertEqual(links.count, 1)
        XCTAssertEqual(links.first?.url.absoluteString, activity)
        XCTAssertEqual(try ProviderLinkParser.parse(URL(string: "https://booking.com/hotel/gb/the-ivy.en-gb.html?aid=123")!).url.absoluteString, hotel)
    }

    func testRejectsSearchRedirectAndUnsafeURLs() throws {
        for raw in [
            "https://www.getyourguide.com/en-gb/amsterdam-l36/",
            "https://www.viator.com/Amsterdam/d525-ttd",
            "https://www.booking.com/searchresults.html?ss=London",
            "https://www.expedia.com/Hotel-Search?destination=London",
            "https://www.opentable.co.uk/s?term=London",
            "https://www.sevenrooms.com/explore/oudh1722",
            "https://getyourguide.com.evil.test/amsterdam-t907734",
            "https://www.booking.com.evil.test/hotel/gb/example.html",
            "https://www.viator.com@evil.test/tours/Amsterdam/Cruise/d525-123P1",
            "https://user:password@www.booking.com/hotel/gb/example.html",
            "https://www.booking.com:443/hotel/gb/example.html",
            "http://www.booking.com/hotel/gb/example.html",
            "https://www.booking.com/hotel/gb/a%2Fb.html",
            "https://www.booking.com/hotel/gb/%2e%2e.html",
            "https://www.booking.com/hotel/gb/a%00.html",
            "https://www.getyourguide.com/redirect?url=\(activity)",
            "https://gyg.me/abcd", "https://www.booking.com/Share-abc", "file:///private/data"
        ] {
            XCTAssertThrowsError(try ProviderLinkParser.parse(XCTUnwrap(URL(string: raw))), raw)
        }
    }

    func testBoundsInputAndTitle() throws {
        XCTAssertThrowsError(try ProviderLinkParser.links(in: [activity, hotel]))
        XCTAssertThrowsError(try ProviderLinkParser.links(in: [String(repeating: "x", count: 8_001)]))
        XCTAssertThrowsError(try ProviderLinkParser.links(in: Array(repeating: activity, count: 17)))
        XCTAssertEqual(try ProviderLinkParser.validatedTitle("  Canal cruise  "), "Canal cruise")
        for title in [" ", String(repeating: "a", count: 161), "Hotel\nspoof", "Hotel\u{0000}"] {
            XCTAssertThrowsError(try ProviderLinkParser.validatedTitle(title))
        }
    }

    func testShareRoutesToProviderOrReelsAndRejectsMixedInput() throws {
        let video = "https://www.instagram.com/reel/abc/"
        XCTAssertEqual(try SharedInput.parse([video]), .reels([URL(string: video)!]))
        XCTAssertEqual(try SharedInput.parse([activity]), .provider(try ProviderLinkParser.parse(URL(string: activity)!)))
        XCTAssertThrowsError(try SharedInput.parse([activity, video])) { error in
            guard case InterestShareFailure.mixed = error else { return XCTFail("Expected mixed-share error, got \(error)") }
        }
        XCTAssertThrowsError(try SharedInput.parse(["https://www.booking.com/searchresults.html"]))
        XCTAssertThrowsError(try SharedInput.parse((1...5).map { "https://www.instagram.com/reel/clip\($0)/" }))
    }

    func testBookingFramesAllowOnlyExactProviderEmbedURLs() {
        for raw in ["about:srcdoc", "about:blank", "https://widget.getyourguide.com/default/activities.frame?locale=en-GB", "https://widget.getyourguide.com/default/availability.frame", "https://widgets.skyscanner.net/widget-server/widgets/render?widgetProps=test"] {
            XCTAssertTrue(SharedLinkParser.isBookingWidgetURL(URL(string: raw)!), raw)
        }
        for raw in ["https://widget.getyourguide.com.evil.test/default/activities.frame", "https://user@widget.getyourguide.com/default/activities.frame", "https://widget.getyourguide.com:443/default/activities.frame", "http://widget.getyourguide.com/default/activities.frame", "https://widget.getyourguide.com/default/other.frame", "https://widgets.skyscanner.net.evil.test/widget-server/widgets/render", "https://user@widgets.skyscanner.net/widget-server/widgets/render", "https://widgets.skyscanner.net/widget-server/v2.0/refer?url=example", "about:srcdoc?url=evil", "javascript:alert(1)"] {
            XCTAssertFalse(SharedLinkParser.isBookingWidgetURL(URL(string: raw)!), raw)
        }
    }

    func testQueueSurvivesReopenAndOnlyExplicitAcknowledgementRemovesIt() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try SharedInbox(directory: directory)
        let first = try store.saveInterest(URL(string: activity)!, title: "Canal cruise")
        let second = try store.saveInterest(URL(string: hotel)!, title: "Our hotel")
        let duplicate = try store.saveInterest(URL(string: activity + "/?date_from=2026-12-22")!, title: "Again")
        XCTAssertEqual(duplicate.id, first.id)
        let reopened = try SharedInbox(directory: directory)
        XCTAssertEqual(try reopened.pendingInterests().count, 2)
        XCTAssertTrue(try reopened.videos().isEmpty)
        try reopened.acknowledgeShares([first.id])
        XCTAssertEqual(try reopened.pendingInterests().count, 2, "Old reel acknowledgements cannot remove provider saves")
        try reopened.acknowledgeInterests([first.id])
        XCTAssertEqual(try reopened.pendingInterests(), [second])
        try reopened.acknowledgeInterests([first.id])
        XCTAssertEqual(try reopened.pendingInterests(), [second], "Acknowledgement replay must be safe")
        try reopened.acknowledgeInterests([second.id])
        XCTAssertTrue(try store.pendingInterests().isEmpty)
    }

    func testInvalidAckDoesNotPartiallyDeleteAndInvalidWritesAreRejected() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try SharedInbox(directory: directory)
        let item = try store.saveInterest(URL(string: hotel)!, title: "Hotel")
        XCTAssertThrowsError(try store.acknowledgeInterests([item.id, "../../bad"]))
        XCTAssertEqual(try store.pendingInterests(), [item])
        XCTAssertThrowsError(try store.saveInterest(URL(string: "https://example.com/hotel")!, title: "Hotel"))
        XCTAssertThrowsError(try store.saveInterest(URL(string: activity)!, title: ""))
        XCTAssertEqual(try store.pendingInterests(), [item])
    }

    func testCorruptOrMismatchedRecordsAreNotSentToWeb() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try SharedInbox(directory: directory)
        let item = try store.saveInterest(URL(string: hotel)!, title: "Hotel")
        let folder = directory.appendingPathComponent("interest-actions")
        try Data("broken".utf8).write(to: folder.appendingPathComponent("bad.json"))
        let target = folder.appendingPathComponent(item.id + ".json")
        var payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: target)) as? [String: Any])
        payload["kind"] = "activity"
        try JSONSerialization.data(withJSONObject: payload).write(to: target, options: .atomic)
        XCTAssertTrue(try store.pendingInterests().isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: target.path), "Invalid records are left intact rather than silently deleted")
    }

    func testBundleEditTimeSurvivesStorageAndOldBundlesStillLoad() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try SharedInbox(directory: directory)
        let edited = ReelBundle(id: UUID().uuidString, name: "Lisbon", urls: [], createdAt: "2026-11-18T00:00:00Z", updatedAt: "2026-11-21T09:05:00.000Z")
        // The web page sends bundles as JSON; decode them the same way the bridge does.
        let fromWeb = try JSONDecoder().decode([ReelBundle].self, from: JSONEncoder().encode([edited]))
        try store.replaceBundles(fromWeb)
        XCTAssertEqual(try store.bundles().first?.updatedAt, "2026-11-21T09:05:00.000Z")
        let legacy = Data(#"[{"id":"\#(UUID().uuidString)","name":"Old","urls":[],"createdAt":"2026-11-17T00:00:00Z"}]"#.utf8)
        try store.replaceBundles(JSONDecoder().decode([ReelBundle].self, from: legacy))
        XCTAssertNil(try store.bundles().first?.updatedAt)
    }

    func testProviderAndReelQueuesAreIndependent() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try SharedInbox(directory: directory)
        let reel = URL(string: "https://www.instagram.com/reel/abc/")!
        let bundle = ReelBundle(id: UUID().uuidString, name: "Amsterdam", urls: [], createdAt: "2026-11-18T00:00:00Z")
        try store.replaceBundles([bundle])
        let share = try store.share([reel], to: bundle.id, openAnalysis: false)
        let place = try store.saveInterest(URL(string: activity)!, title: "Cruise")
        try store.acknowledgeInterests([place.id])
        XCTAssertEqual(try store.videos().map(\.url), [reel])
        XCTAssertEqual(try store.bundles(), [bundle])
        XCTAssertEqual(try store.pendingShares().first?.id, share.id)
        XCTAssertEqual(try store.pendingShares().first?.openAnalysis, false)
    }
}
