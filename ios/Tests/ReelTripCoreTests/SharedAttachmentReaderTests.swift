import XCTest
@testable import ReelTripCore

final class SharedAttachmentReaderTests: XCTestCase {
    func testOneDeadlinePreservesReadyLinkWhenAnotherProviderNeverResponds() async {
        let start = Date()
        let result = await SharedAttachmentReader.read([
            { done in done("https://www.instagram.com/reel/example/") },
            { _ in }, { _ in }, { _ in }
        ], timeout: 0.03)
        XCTAssertEqual(result.values, ["https://www.instagram.com/reel/example/"])
        XCTAssertTrue(result.timedOut)
        XCTAssertLessThan(Date().timeIntervalSince(start), 1)
    }
    func testDuplicateAndLateCallbacksCannotResumeTwiceOrReplaceSavedResult() async {
        var late: ((String?) -> Void)?
        let result = await SharedAttachmentReader.read([
            { done in done("first"); done("duplicate") },
            { done in late = done }
        ], timeout: 0.02)
        late?("late")
        XCTAssertEqual(result.values, ["first"])
        XCTAssertTrue(result.timedOut)
    }
    func testReadyProvidersKeepSourceOrderAndFinishWithoutWaitingForDeadline() async {
        var first: ((String?) -> Void)?
        let start = Date()
        let result = await SharedAttachmentReader.read([
            { done in first = done },
            { done in done("second"); first?("first") }
        ], timeout: 2)
        XCTAssertEqual(result.values, ["first", "second"])
        XCTAssertFalse(result.timedOut)
        XCTAssertLessThan(Date().timeIntervalSince(start), 1)
    }
}
