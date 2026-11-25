import XCTest
@testable import ReelTripCore

final class SharedVideoTests: XCTestCase {
    func testCaptionAndTracking() throws {
        let urls = try SharedLinkParser.parse(["Watch this: https://www.instagram.com/reel/DeSbT_lEZGL/?igsh=abc."])
        XCTAssertEqual(urls.map(\.absoluteString), ["https://www.instagram.com/reel/DeSbT_lEZGL/"])
    }
    func testDuplicatesAndShortLinks() throws {
        let link = "https://vm.tiktok.com/Zabc/"
        XCTAssertEqual(try SharedLinkParser.parse([link, link]).count, 1)
        XCTAssertTrue(SharedVideo(url: URL(string: link)!).needsResolution)
    }
    func testRejectsUntrustedURLs() {
        for url in ["https://instagram.com.evil.test/reel/abc", "https://user@instagram.com/reel/abc", "https://instagram.com:999/reel/abc", "http://instagram.com/reel/abc", "https://instagram.com/profile", "file:///private/data", "https://instagram.com/reel/a%2Fb"] {
            XCTAssertThrowsError(try SharedLinkParser.parse([url]), url)
        }
    }
    func testBoundsInput() {
        XCTAssertThrowsError(try SharedLinkParser.parse([String(repeating: "a", count: 8001)]))
        XCTAssertThrowsError(try SharedLinkParser.parse((1...5).map { "https://instagram.com/reel/abc\($0)" }))
    }
    func testImportAlwaysUsesTrustedWebsite() throws {
        let video = SharedVideo(url: try XCTUnwrap(URL(string: "https://www.tiktok.com/@abc/video/123")))
        let parts = try XCTUnwrap(URLComponents(url: SharedLinkParser.importURL(for: video), resolvingAgainstBaseURL: false))
        XCTAssertEqual(parts.host, SharedLinkParser.website.host)
        XCTAssertEqual(parts.queryItems?.first(where: { $0.name == "url" })?.value, video.url.absoluteString)
    }
    func testInboxPersistsDeduplicatesAndDeletes() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try SharedInbox(directory: directory)
        let url = try XCTUnwrap(URL(string: "https://instagram.com/reel/abc"))
        try store.save([url]); try store.save([url])
        let reloaded = try SharedInbox(directory: directory)
        XCTAssertEqual(try reloaded.videos().count, 1)
        try Data("broken".utf8).write(to: directory.appendingPathComponent("bad.json"))
        XCTAssertEqual(try reloaded.videos().count, 1)
        try reloaded.remove(try XCTUnwrap(reloaded.videos().first))
        XCTAssertTrue(try reloaded.videos().isEmpty)
    }
    func testInboxRejectsInvalidWrite() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try SharedInbox(directory: directory)
        XCTAssertThrowsError(try store.save([URL(string: "https://example.com/private")!]))
        XCTAssertTrue(try store.videos().isEmpty)
    }
}
