import Foundation
import CryptoKit

public enum SharedAttachmentReader {
    public struct Result {
        public let values: [String]
        public let timedOut: Bool
    }
    public typealias Loader = (@escaping (String?) -> Void) -> Void

    // A host may never call its item-provider callback. One deadline bounds the whole share.
    public static func read(_ loaders: [Loader], timeout: TimeInterval = 12) async -> Result {
        guard !loaders.isEmpty else { return Result(values: [], timedOut: false) }
        return await withCheckedContinuation { continuation in
            let batch = AttachmentBatch(count: loaders.count) { continuation.resume(returning: $0) }
            DispatchQueue.global().asyncAfter(deadline: .now() + max(0, timeout)) { batch.finish(timedOut: true) }
            for (index, load) in loaders.enumerated() {
                load { batch.receive($0, at: index) }
            }
        }
    }
}

private final class AttachmentBatch: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String?]
    private var received: Set<Int> = []
    private var completed = false
    private let completion: (SharedAttachmentReader.Result) -> Void
    init(count: Int, completion: @escaping (SharedAttachmentReader.Result) -> Void) {
        values = Array(repeating: nil, count: count); self.completion = completion
    }
    func receive(_ value: String?, at index: Int) {
        lock.lock()
        guard !completed, received.insert(index).inserted else { lock.unlock(); return }
        values[index] = value
        let ready = received.count == values.count
        lock.unlock()
        if ready { finish(timedOut: false) }
    }
    func finish(timedOut: Bool) {
        lock.lock()
        guard !completed else { lock.unlock(); return }
        completed = true
        let result = SharedAttachmentReader.Result(values: values.compactMap { $0 }, timedOut: timedOut)
        lock.unlock()
        completion(result)
    }
}

public enum ShareFailure: LocalizedError {
    case noVideo, oversized, tooMany, inboxFull, unavailable
    public var errorDescription: String? {
        switch self {
        case .noVideo: return "Share an individual public Instagram or TikTok video link. This item does not contain a supported link."
        case .oversized: return "This shared item is too large. Share the video link without extra text."
        case .tooMany: return "Share up to four video links at a time."
        case .inboxFull: return "Your Reel Library is full. Remove some videos in ReelTrip and try again."
        case .unavailable: return "Your Reel Library is unavailable. The app and Share Extension must use the same signed App Group."
        }
    }
}

public struct SharedVideo: Codable, Identifiable, Equatable {
    public let url: URL
    public let addedAt: Date
    public var id: String { SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined() }
    public var platform: String { url.host?.contains("tiktok") == true ? "TikTok" : "Instagram" }
    public var needsResolution: Bool { ["vm.tiktok.com", "vt.tiktok.com"].contains(url.host ?? "") }
    public init(url: URL, addedAt: Date = Date()) { self.url = url; self.addedAt = addedAt }
}

public enum SharedLinkParser {
    public static let website = URL(string: "https://reeltrip-travel-studio.earthylark68.chatgpt.site")!
    public static func isPreviewURL(_ url: URL) -> Bool {
        guard url.scheme == "https", url.user == nil, url.password == nil, url.port == nil else { return false }
        let path = url.path
        if ["www.instagram.com", "instagram.com"].contains(url.host ?? "") {
            return path.range(of: "^/(p|reel|reels)/[A-Za-z0-9_-]{1,100}/embed/?$", options: .regularExpression) != nil
        }
        if url.host == "www.tiktok.com" {
            return path.range(of: "^/player/v1/[0-9]{1,25}/?$", options: .regularExpression) != nil
        }
        return false
    }
    public static func isBookingWidgetURL(_ url: URL) -> Bool {
        // These are allowed as subframes only by PlannerViewController.
        if ["about:srcdoc", "about:blank"].contains(url.absoluteString) { return true }
        guard url.scheme == "https", url.user == nil, url.password == nil, url.port == nil else { return false }
        if url.host == "widget.getyourguide.com" {
            return ["/default/activities.frame", "/default/availability.frame"].contains(url.path)
        }
        if url.host == "widgets.skyscanner.net" {
            return url.path == "/widget-server/widgets/render"
        }
        return false
    }
    public static func identity(_ url: URL) -> String {
        let parts = url.path.split(separator: "/")
        if url.host?.contains("instagram") == true, let id = parts.last { return "instagram-" + id }
        if parts.contains("video"), let id = parts.last { return "tiktok-" + id }
        return url.absoluteString
    }
    public static func parse(_ fields: [String]) throws -> [URL] {
        guard fields.count <= 16, fields.allSatisfy({ $0.utf8.count <= 8_000 }) else { throw ShareFailure.oversized }
        let expression = try NSRegularExpression(pattern: "https://[^\\s<>\"']+", options: [.caseInsensitive])
        var result: [URL] = []
        for text in fields {
            for match in expression.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
                guard let range = Range(match.range, in: text) else { continue }
                let raw = String(text[range]).trimmingCharacters(in: CharacterSet(charactersIn: ".,;!?)\\]}"))
                guard var parts = URLComponents(string: raw), let host = parts.host?.lowercased(), parts.scheme?.lowercased() == "https", parts.user == nil, parts.password == nil, parts.port == nil else { continue }
                let path = parts.percentEncodedPath
                let instagram = ["instagram.com", "www.instagram.com"].contains(host) && path.range(of: "^/(p|reel|reels)/[A-Za-z0-9_-]+/?$", options: .regularExpression) != nil
                let tiktok = ["tiktok.com", "www.tiktok.com", "m.tiktok.com"].contains(host) && path.range(of: "^/@[^/]+/video/[0-9]+/?$", options: .regularExpression) != nil
                let short = ["vm.tiktok.com", "vt.tiktok.com"].contains(host) && path.range(of: "^/[A-Za-z0-9_-]+/?$", options: .regularExpression) != nil
                guard instagram || tiktok || short else { continue }
                parts.scheme = "https"; parts.host = host; parts.query = nil; parts.fragment = nil
                guard let url = parts.url else { continue }
                if !result.contains(url) { result.append(url) }
            }
        }
        guard !result.isEmpty else { throw ShareFailure.noVideo }
        guard result.count <= 4 else { throw ShareFailure.tooMany }
        return result
    }
    public static func importURL(for video: SharedVideo) -> URL {
        var parts = URLComponents(url: website, resolvingAgainstBaseURL: false)!
        parts.path = "/"
        parts.queryItems = [URLQueryItem(name: "share", value: "1"), URLQueryItem(name: "action", value: "plan"), URLQueryItem(name: "url", value: video.url.absoluteString)]
        return parts.url!
    }
}

// Each video is a separate file. Atomic replacement prevents partial JSON reads
// across the containing app and extension; identical URLs share one filename.
public final class SharedInbox {
    private let directory: URL
    private let manager = FileManager.default
    public init(directory: URL) throws {
        self.directory = directory
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        var folder = directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try folder.setResourceValues(values)
    }
    public func videos() throws -> [SharedVideo] {
        try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .compactMap { try? JSONDecoder().decode(SharedVideo.self, from: Data(contentsOf: $0)) }
            .filter { (try? SharedLinkParser.parse([$0.url.absoluteString]).first) == $0.url }
            .sorted { $0.addedAt > $1.addedAt }
    }
    public func save(_ urls: [URL]) throws {
        let valid = try SharedLinkParser.parse(urls.map(\.absoluteString))
        let existing = try videos()
        let newURLs = valid.filter { candidate in !existing.contains { SharedLinkParser.identity($0.url) == SharedLinkParser.identity(candidate) } }
        guard existing.count + newURLs.count <= 100 else { throw ShareFailure.inboxFull }
        for url in newURLs {
            let video = SharedVideo(url: url)
            let data = try JSONEncoder().encode(video)
            #if os(iOS)
            try data.write(to: directory.appendingPathComponent(video.id + ".json"), options: [.atomic, .completeFileProtection])
            #else
            try data.write(to: directory.appendingPathComponent(video.id + ".json"), options: .atomic)
            #endif
        }
    }
    public func remove(_ video: SharedVideo) throws {
        for saved in try videos() where SharedLinkParser.identity(saved.url) == SharedLinkParser.identity(video.url) {
            let file = directory.appendingPathComponent(saved.id + ".json")
            if manager.fileExists(atPath: file.path) { try manager.removeItem(at: file) }
        }
    }
}

public struct ReelBundle: Codable, Equatable {
    public let id: String
    public let name: String
    public let urls: [URL]
    public let createdAt: String
    /// The web page's last edit to this bundle. Kept so the web can merge by
    /// keeping the newer copy; bundles saved before this field have none.
    public let updatedAt: String?
    public init(id: String, name: String, urls: [URL], createdAt: String, updatedAt: String? = nil) {
        self.id = id; self.name = name; self.urls = urls; self.createdAt = createdAt; self.updatedAt = updatedAt
    }
}
public struct ReelShareAction: Codable {
    public let id: String
    public let urls: [URL]
    public let bundleId: String?
    public let createdAt: Date
    public var jobs: [String: String]?
    public var openAnalysis: Bool?
    /// A shared (group) bucket to add the reels to. The extension has no member
    /// cookie, so the app's web view adds them when ReelTrip next opens.
    public var sharedBucketId: String?
}
/// A shared bucket this iPhone's ReelTrip app has joined, as published by the
/// trusted web page. Only the id and name: membership is checked by the server.
public struct SharedBucketChoice: Codable, Equatable {
    public let id: String
    public let name: String
    public init(id: String, name: String) { self.id = id; self.name = name }
}
public enum SharedBucketFailure: LocalizedError {
    case missing
    public var errorDescription: String? {
        "Choose a shared bucket. To see one here, open ReelTrip → Shared and start a group trip or paste your invite link, then share this reel again."
    }
}
public enum BundleFailure: LocalizedError {
    case invalid, missing, full
    public var errorDescription: String? {
        switch self {
        case .invalid: return "Your bundles could not be read. Open ReelTrip and try again."
        case .missing: return "Choose a bundle, or create one in ReelTrip first."
        case .full: return "A bundle can hold 12 reels. Choose another bundle."
        }
    }
}

public enum InterestShareFailure: LocalizedError {
    case unsupported, multiple, mixed, title, full, invalid
    public var errorDescription: String? {
        switch self {
        case .unsupported: return "Share an Instagram or TikTok video, or an individual activity, hotel or restaurant page from Viator, GetYourGuide, Booking.com, Expedia, OpenTable or SevenRooms. For booking pages, open short links and search results first, then share the page itself."
        case .multiple: return "Share one activity, hotel or restaurant page at a time."
        case .mixed: return "Share your reel and booking page separately so each can be saved in the right place."
        case .title: return "Enter a name between 1 and 160 characters."
        case .full: return "Open ReelTrip to import your saved places before adding more."
        case .invalid: return "Your saved place could not be read. Please share the page again."
        }
    }
}

public struct SharedProviderLink: Equatable {
    public let url: URL
    public let kind: String
    public let provider: String
    public var suggestedTitle: String { "\(provider) \(kind)" }
}

// A share records the selected provider page only. We neither follow redirects
// nor retrieve page content, account details, prices or availability here.
public enum ProviderLinkParser {
    public static func parse(_ url: URL) throws -> SharedProviderLink {
        guard url.absoluteString.utf8.count <= 2_048,
              var parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "https", let host = parts.host?.lowercased(),
              parts.user == nil, parts.password == nil, parts.port == nil else { throw InterestShareFailure.unsupported }
        let path = parts.percentEncodedPath
        let provider: String, kind: String, canonicalHost: String
        func matches(_ pattern: String) -> Bool { path.range(of: pattern, options: .regularExpression) != nil }
        if ["www.viator.com", "viator.com"].contains(host), matches("^/tours/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/d[0-9]+-[A-Za-z0-9_]+/?$") {
            provider = "Viator"; kind = "activity"; canonicalHost = "www.viator.com"
        } else if ["www.getyourguide.com", "getyourguide.com"].contains(host), matches("^/(?:[a-z]{2}(?:-[a-z]{2})?/)?[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*-t[1-9][0-9]{0,9}/?$") {
            provider = "GetYourGuide"; kind = "activity"; canonicalHost = "www.getyourguide.com"
        } else if ["www.booking.com", "booking.com"].contains(host), matches("^/hotel/[a-z]{2}/[A-Za-z0-9_-]+(?:\\.[a-z]{2}(?:-[a-z]{2})?)?\\.html/?$") {
            provider = "Booking.com"; kind = "hotel"; canonicalHost = "www.booking.com"
        } else if ["www.expedia.com", "expedia.com", "www.expedia.co.uk", "expedia.co.uk"].contains(host), matches("^/[A-Za-z0-9_-]+\\.h[1-9][0-9]*\\.Hotel-Information/?$") {
            provider = "Expedia"; kind = "hotel"; canonicalHost = host.hasSuffix(".co.uk") ? "www.expedia.co.uk" : "www.expedia.com"
        } else if ["www.opentable.com", "opentable.com", "www.opentable.co.uk", "opentable.co.uk"].contains(host), matches("^/r/[A-Za-z0-9_-]+/?$") {
            provider = "OpenTable"; kind = "restaurant"; canonicalHost = host.hasSuffix(".co.uk") ? "www.opentable.co.uk" : "www.opentable.com"
        } else if ["www.sevenrooms.com", "sevenrooms.com"].contains(host), matches("^/explore/[A-Za-z0-9_-]+/reservations/create/search/?$") {
            provider = "SevenRooms"; kind = "restaurant"; canonicalHost = "www.sevenrooms.com"
        } else { throw InterestShareFailure.unsupported }
        parts.scheme = "https"; parts.host = canonicalHost; parts.query = nil; parts.fragment = nil
        parts.percentEncodedPath = path.hasSuffix("/") ? String(path.dropLast()) : path
        guard let canonicalURL = parts.url, canonicalURL.absoluteString.utf8.count <= 2_048 else { throw InterestShareFailure.unsupported }
        return SharedProviderLink(url: canonicalURL, kind: kind, provider: provider)
    }
    public static func links(in fields: [String]) throws -> [SharedProviderLink] {
        guard fields.count <= 16, fields.allSatisfy({ $0.utf8.count <= 8_000 }) else { throw ShareFailure.oversized }
        let expression = try NSRegularExpression(pattern: "https://[^\\s<>\"']+", options: [.caseInsensitive])
        var result: [SharedProviderLink] = []
        for text in fields {
            for match in expression.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
                guard let range = Range(match.range, in: text) else { continue }
                let raw = String(text[range]).trimmingCharacters(in: CharacterSet(charactersIn: ".,;!?)\\]}"))
                guard let url = URL(string: raw), let link = try? parse(url) else { continue }
                if !result.contains(where: { $0.url == link.url }) { result.append(link) }
            }
        }
        guard result.count <= 1 else { throw InterestShareFailure.multiple }
        return result
    }
    public static func validatedTitle(_ value: String) throws -> String {
        let title = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.count <= 160,
              title.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { throw InterestShareFailure.title }
        return title
    }
}

public struct SharedInterest: Codable, Equatable, Identifiable {
    public let id: String
    public let url: URL
    public let title: String
    public let kind: String
    public let provider: String
    public let addedAt: Date
}

public enum SharedInput: Equatable {
    case reels([URL])
    case provider(SharedProviderLink)
    public static func parse(_ fields: [String]) throws -> SharedInput {
        let providers = try ProviderLinkParser.links(in: fields)
        var videos: [URL] = []
        do { videos = try SharedLinkParser.parse(fields) }
        catch ShareFailure.noVideo { /* The shared item may be a booking page. */ }
        if let provider = providers.first {
            guard videos.isEmpty else { throw InterestShareFailure.mixed }
            return .provider(provider)
        }
        guard !videos.isEmpty else { throw InterestShareFailure.unsupported }
        return .reels(videos)
    }
}

extension SharedInbox {
    private var interestsFolder: URL { directory.appendingPathComponent("interest-actions", isDirectory: true) }
    public func pendingInterests() throws -> [SharedInterest] {
        guard manager.fileExists(atPath: interestsFolder.path) else { return [] }
        return try manager.contentsOfDirectory(at: interestsFolder, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.compactMap { file in
                guard let data = try? Data(contentsOf: file), data.count <= 16_000,
                      let item = try? JSONDecoder().decode(SharedInterest.self, from: data),
                      UUID(uuidString: item.id)?.uuidString == item.id,
                      file.deletingPathExtension().lastPathComponent == item.id,
                      let link = try? ProviderLinkParser.parse(item.url), link.url == item.url,
                      link.kind == item.kind, link.provider == item.provider,
                      (try? ProviderLinkParser.validatedTitle(item.title)) == item.title,
                      item.addedAt.timeIntervalSince1970.isFinite else { return nil }
                return item
            }.sorted { $0.addedAt < $1.addedAt }
    }
    @discardableResult public func saveInterest(_ url: URL, title: String) throws -> SharedInterest {
        let link = try ProviderLinkParser.parse(url)
        let name = try ProviderLinkParser.validatedTitle(title)
        let pending = try pendingInterests()
        if let existing = pending.first(where: { $0.url == link.url }) { return existing }
        guard pending.count < 100 else { throw InterestShareFailure.full }
        let item = SharedInterest(id: UUID().uuidString, url: link.url, title: name, kind: link.kind, provider: link.provider, addedAt: Date())
        try manager.createDirectory(at: interestsFolder, withIntermediateDirectories: true)
        let target = interestsFolder.appendingPathComponent(item.id + ".json")
        let data = try JSONEncoder().encode(item)
        #if os(iOS)
        try data.write(to: target, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: target, options: .atomic)
        #endif
        return item
    }
    public func acknowledgeInterests(_ ids: [String]) throws {
        // Validate the entire message before deleting any entry. Replays are safe;
        // unacknowledged items remain available to older website versions.
        guard ids.count <= 100, ids.allSatisfy({ UUID(uuidString: $0) != nil }) else { throw InterestShareFailure.invalid }
        for id in Set(ids.compactMap { UUID(uuidString: $0)?.uuidString }) {
            let file = interestsFolder.appendingPathComponent(id + ".json")
            if manager.fileExists(atPath: file.path) { try manager.removeItem(at: file) }
        }
    }
}

extension SharedInbox {
    private var bundleFile: URL { directory.appendingPathComponent("bundles.data") }
    private var actionsFolder: URL { directory.appendingPathComponent("share-actions", isDirectory: true) }
    public func bundles() throws -> [ReelBundle] {
        guard manager.fileExists(atPath: bundleFile.path) else { return [] }
        let data = try Data(contentsOf: bundleFile)
        guard data.count <= 300_000 else { throw BundleFailure.invalid }
        let values = try JSONDecoder().decode([ReelBundle].self, from: data)
        try validateBundles(values)
        return values
    }
    private func validateBundles(_ values: [ReelBundle]) throws {
        guard values.count <= 20, Set(values.map(\.id)).count == values.count else { throw BundleFailure.invalid }
        for b in values {
            guard UUID(uuidString: b.id) != nil, !b.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  b.name.count <= 80, b.urls.count <= 12, b.createdAt.count <= 40, (b.updatedAt?.count ?? 0) <= 40 else { throw BundleFailure.invalid }
            for url in b.urls { guard try SharedLinkParser.parse([url.absoluteString]).first == url else { throw BundleFailure.invalid } }
        }
    }
    public func replaceBundles(_ values: [ReelBundle]) throws {
        try validateBundles(values)
        let data = try JSONEncoder().encode(values)
        #if os(iOS)
        try data.write(to: bundleFile, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: bundleFile, options: .atomic)
        #endif
    }
    private var sharedBucketFile: URL { directory.appendingPathComponent("shared-buckets.data") }
    public func sharedBuckets() throws -> [SharedBucketChoice] {
        guard manager.fileExists(atPath: sharedBucketFile.path) else { return [] }
        let data = try Data(contentsOf: sharedBucketFile)
        guard data.count <= 40_000 else { throw BundleFailure.invalid }
        let values = try JSONDecoder().decode([SharedBucketChoice].self, from: data)
        try validateSharedBuckets(values)
        return values
    }
    private func validateSharedBuckets(_ values: [SharedBucketChoice]) throws {
        guard values.count <= 50, Set(values.map { $0.id.lowercased() }).count == values.count else { throw BundleFailure.invalid }
        for b in values {
            let name = b.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard UUID(uuidString: b.id) != nil, !name.isEmpty, b.name.count <= 80,
                  b.name.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { throw BundleFailure.invalid }
        }
    }
    public func replaceSharedBuckets(_ values: [SharedBucketChoice]) throws {
        try validateSharedBuckets(values)
        let data = try JSONEncoder().encode(values)
        #if os(iOS)
        try data.write(to: sharedBucketFile, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: sharedBucketFile, options: .atomic)
        #endif
    }
    public func pendingShares() throws -> [ReelShareAction] {
        guard manager.fileExists(atPath: actionsFolder.path) else { return [] }
        return try manager.contentsOfDirectory(at: actionsFolder, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.prefix(100).compactMap { file in
                guard let data = try? Data(contentsOf: file), data.count <= 40_000,
                      let action = try? JSONDecoder().decode(ReelShareAction.self, from: data),
                      UUID(uuidString: action.id) != nil, file.deletingPathExtension().lastPathComponent == action.id,
                      action.sharedBucketId.map({ UUID(uuidString: $0) != nil && action.bundleId == nil }) ?? true,
                      (try? SharedLinkParser.parse(action.urls.map(\.absoluteString))) == action.urls else { return nil }
                return action
            }.sorted { $0.createdAt < $1.createdAt }
    }
    @discardableResult public func share(_ urls: [URL], to bundleId: String?, openAnalysis: Bool = true, sharedBucketId: String? = nil) throws -> ReelShareAction {
        let valid = try SharedLinkParser.parse(urls.map(\.absoluteString))
        let pending = try pendingShares()
        guard pending.count < 100 else { throw ShareFailure.inboxFull }
        if let sharedBucketId {
            guard bundleId == nil, try sharedBuckets().contains(where: { $0.id == sharedBucketId }) else { throw SharedBucketFailure.missing }
        }
        if let bundleId {
            guard let bundle = try bundles().first(where: { $0.id == bundleId }) else { throw BundleFailure.missing }
            let queued = pending.filter { $0.bundleId == bundleId }.flatMap(\.urls)
            guard Set((bundle.urls + queued + valid).map(SharedLinkParser.identity)).count <= 12 else { throw BundleFailure.full }
        }
        try save(valid)
        try manager.createDirectory(at: actionsFolder, withIntermediateDirectories: true)
        let action = ReelShareAction(id: UUID().uuidString, urls: valid, bundleId: bundleId, createdAt: Date(), jobs: nil, openAnalysis: openAnalysis, sharedBucketId: sharedBucketId)
        let target = actionsFolder.appendingPathComponent(action.id + ".json")
        let data = try JSONEncoder().encode(action)
        #if os(iOS)
        try data.write(to: target, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: target, options: .atomic)
        #endif
        return action
    }
    public func attachJobs(_ jobs: [String: String], to actionId: String) throws {
        guard var action = try pendingShares().first(where: { $0.id == actionId }) else { return }
        guard jobs.count <= 4, jobs.allSatisfy({ key, value in action.urls.contains(where: { $0.absoluteString == key }) && UUID(uuidString: value) != nil }) else { throw BundleFailure.invalid }
        action.jobs = jobs
        let data = try JSONEncoder().encode(action)
        #if os(iOS)
        try data.write(to: actionsFolder.appendingPathComponent(actionId + ".json"), options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: actionsFolder.appendingPathComponent(actionId + ".json"), options: .atomic)
        #endif
    }
    public func acknowledgeShares(_ ids: [String]) throws {
        guard ids.count <= 100 else { throw BundleFailure.invalid }
        for id in ids {
            guard UUID(uuidString: id) != nil else { throw BundleFailure.invalid }
            let file = actionsFolder.appendingPathComponent(id + ".json")
            if manager.fileExists(atPath: file.path) { try manager.removeItem(at: file) }
        }
    }
}
