import XCTest

final class ShareActivationTests: XCTestCase {
    func testMixedContentActivationStillRequiresSupportedTextOrURL() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("ReelTripShare/Info.plist"))
        let plist = try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
        let extensionInfo = try XCTUnwrap(plist["NSExtension"] as? [String: Any])
        let attributes = try XCTUnwrap(extensionInfo["NSExtensionAttributes"] as? [String: Any])
        let rule = try XCTUnwrap(attributes["NSExtensionActivationRule"] as? [String: Any])
        // Version 2 permits a supported URL/text representation alongside a thumbnail.
        XCTAssertEqual(rule["NSExtensionActivationDictionaryVersion"] as? Int, 2)
        XCTAssertEqual(rule["NSExtensionActivationSupportsText"] as? Bool, true)
        XCTAssertEqual(rule["NSExtensionActivationSupportsWebURLWithMaxCount"] as? Int, 4)
        XCTAssertEqual(Set(rule.keys), ["NSExtensionActivationDictionaryVersion",
            "NSExtensionActivationSupportsText", "NSExtensionActivationSupportsWebURLWithMaxCount"],
            "Do not activate for image/movie-only shares or replace the dictionary with TRUEPREDICATE")
    }
}
