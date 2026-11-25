import UIKit
import WebKit

final class PlannerViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "ReelTrip"
        view.backgroundColor = .systemBackground
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.userContentController.add(self, name: "reeltripLibrary")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        navigationItem.leftBarButtonItem = UIBarButtonItem(image: UIImage(systemName: "house"), style: .plain, target: self, action: #selector(home))
        navigationItem.leftBarButtonItem?.accessibilityLabel = "Open Reel Library"
        let info = UIBarButtonItem(image: UIImage(systemName: "info.circle"), style: .plain, target: self, action: #selector(about))
        info.accessibilityLabel = "About ReelTrip"
        if let home = navigationItem.leftBarButtonItem { navigationItem.leftBarButtonItems = [home, info] }
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Reel Library", style: .plain, target: self, action: #selector(home))
        home()
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        refreshLibrary()
    }
    @objc private func home() { webView.load(URLRequest(url: SharedLinkParser.website)) }
    @objc private func about() {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Unknown"
        let alert = UIAlertController(title: "ReelTrip \(version) (\(build))", message: "In Instagram or TikTok, open the iPhone share sheet and choose ReelTrip. Tap Save as to choose Reel Library, Analyse this reel, Add to a bundle or Add to a shared bucket. You can also share an individual Viator, GetYourGuide, Booking.com, Expedia, OpenTable or SevenRooms page to save it in Interested. Open this app after sharing to import your saved items.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Reload ReelTrip", style: .default) { [weak self] _ in self?.home() })
        alert.addAction(UIAlertAction(title: "Done", style: .cancel))
        present(alert, animated: true)
    }
    func refreshLibrary() {
        do {
            let store = try AppInbox.open()
            let videos = try store.videos()
            navigationItem.rightBarButtonItem?.title = "Library (\(videos.count))"
            let formatter = ISO8601DateFormatter()
            let bundles = try store.bundles()
            let pending = try store.pendingShares()
            let interests = try store.pendingInterests()
            sendLibraryEvent(["videos": videos.map { ["url": $0.url.absoluteString, "addedAt": formatter.string(from: $0.addedAt)] },
                              "bundles": bundles.map { ["id": $0.id, "name": $0.name, "urls": $0.urls.map(\.absoluteString), "createdAt": $0.createdAt] as [String: Any] },
                              "pendingInterests": interests.map { ["id": $0.id, "url": $0.url.absoluteString, "title": $0.title, "kind": $0.kind, "provider": $0.provider, "addedAt": formatter.string(from: $0.addedAt)] },
                              "pendingShares": pending.map { ["id": $0.id, "urls": $0.urls.map(\.absoluteString), "bundleId": $0.bundleId as Any? ?? NSNull(), "jobs": $0.jobs ?? [:], "openAnalysis": $0.openAnalysis ?? true, "sharedBucketId": $0.sharedBucketId as Any? ?? NSNull()] as [String: Any] }])
        } catch { sendLibraryEvent(["error": "Your saved items could not be loaded. Please reopen ReelTrip."]) }
    }
    private func sendLibraryEvent(_ payload: [String: Any]) {
        guard let url = webView?.url, internalURL(url),
              let data = try? JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed]),
              let json = String(data: data, encoding: .utf8) else { return }
        // JSON serialization prevents saved links from becoming executable code.
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('reeltrip-native-library',{detail:\(json)}))", completionHandler: nil)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "reeltripLibrary", message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https",
              message.frameInfo.securityOrigin.host == SharedLinkParser.website.host,
              message.frameInfo.securityOrigin.port == 0 || message.frameInfo.securityOrigin.port == 443,
              let url = webView.url, internalURL(url),
              let payload = message.body as? [String: Any], let action = payload["action"] as? String else { return }
        do {
            let store = try AppInbox.open()
            switch action {
            case "save":
                guard let fields = payload["urls"] as? [String], !fields.isEmpty, fields.count <= 4 else { return }
                try store.save(SharedLinkParser.parse(fields))
            case "remove":
                guard let raw = payload["url"] as? String else { return }
                let urls = try SharedLinkParser.parse([raw])
                for video in try store.videos() where urls.contains(where: { SharedLinkParser.identity($0) == SharedLinkParser.identity(video.url) }) { try store.remove(video) }
            case "bundles":
                guard let raw = payload["bundles"] as? [[String: Any]], raw.count <= 20 else { return }
                let data = try JSONSerialization.data(withJSONObject: raw)
                try store.replaceBundles(JSONDecoder().decode([ReelBundle].self, from: data))
                return
            case "sharedBuckets":
                // The trusted page lists the shared buckets this app's member has joined,
                // so the Share Extension can offer them. Ids and names only.
                guard let raw = payload["buckets"] as? [[String: Any]], raw.count <= 50 else { return }
                let data = try JSONSerialization.data(withJSONObject: raw)
                try store.replaceSharedBuckets(JSONDecoder().decode([SharedBucketChoice].self, from: data))
                return
            case "acknowledge":
                guard let ids = payload["ids"] as? [String] else { return }
                try store.acknowledgeShares(ids)
                return
            case "acknowledgeInterests":
                guard let ids = payload["ids"] as? [String] else { return }
                try store.acknowledgeInterests(ids)
                return
            case "library": break
            default: return
            }
            refreshLibrary()
        } catch { sendLibraryEvent(["error": "Couldn’t update your saved iPhone items. Please try again."]) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { refreshLibrary() }
    private func internalURL(_ url: URL) -> Bool {
        url.scheme == "https" && url.host == SharedLinkParser.website.host && url.port == nil && url.user == nil && url.password == nil
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if internalURL(url) { decisionHandler(.allow); return }
        // Third-party players are subframes only. The library bridge still accepts
        // messages exclusively from ReelTrip's trusted main frame.
        if action.targetFrame?.isMainFrame == false,
           SharedLinkParser.isPreviewURL(url) || SharedLinkParser.isBookingWidgetURL(url) {
            decisionHandler(.allow); return
        }
        if action.navigationType == .linkActivated, ["https", "http"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, internalURL(url), navigationAction.targetFrame == nil { webView.load(URLRequest(url: url)) }
        return nil
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        let alert = UIAlertController(title: "Unable to load ReelTrip", message: "Check your connection and tap Home to retry. Your saved reels remain in Reel Library.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        if presentedViewController == nil { present(alert, animated: true) }
    }
}
