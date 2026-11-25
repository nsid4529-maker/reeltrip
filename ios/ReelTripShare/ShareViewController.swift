import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let heading = UILabel()
    private let textView = UITextView()
    private let options = UIStackView()
    private let saveButton = UIButton(type: .system)
    private let retryButton = UIButton(type: .system)
    private var finished = false
    private var readAttempt = 0
    private var partialRead = false
    private var incomingURLs: [URL] = []
    private var incomingProvider: SharedProviderLink?
    private var interestTitle = ""
    private var loading = true
    private enum Destination: String, CaseIterable {
        case library = "Save to Reel Library"
        case analyse = "Analyse this reel"
        case bundle = "Add to a bundle"
        case shared = "Add to a shared bucket"
    }
    private var destination = Destination.analyse
    private var useBundle: Bool { destination == .bundle }
    private var useShared: Bool { destination == .shared }
    private var selectedBundle: ReelBundle?
    private var selectedShared: SharedBucketChoice?
    private func reloadConfigurationItems() {
        for child in options.arrangedSubviews { child.removeFromSuperview() }
        func option(_ title: String, _ value: String, _ action: @escaping () -> Void) {
            let button = UIButton(type: .system)
            var configuration = UIButton.Configuration.gray()
            configuration.title = title; configuration.subtitle = value
            configuration.image = UIImage(systemName: "chevron.right")
            configuration.imagePlacement = .trailing
            configuration.titleAlignment = .leading
            configuration.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 14, bottom: 14, trailing: 14)
            button.configuration = configuration
            button.contentHorizontalAlignment = .leading
            button.isEnabled = !loading && !finished
            button.addAction(UIAction { _ in action() }, for: .touchUpInside)
            options.addArrangedSubview(button)
        }
        if incomingProvider != nil {
            option("Name", interestTitle) { [weak self] in self?.chooseInterestTitle() }
            return
        }
        option("Save as", destination.rawValue) { [weak self] in self?.chooseMode() }
        if useShared {
            option("Shared bucket", selectedShared?.name ?? "Choose a shared bucket") { [weak self] in self?.chooseShared() }
        }
        if useBundle {
            option("Bundle", selectedBundle?.name ?? "Choose a bundle") { [weak self] in self?.chooseBundle() }
        }
    }
    private func pushConfigurationViewController(_ controller: UIViewController) {
        controller.navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak controller] _ in controller?.dismiss(animated: true) })
        present(UINavigationController(rootViewController: controller), animated: true)
    }
    private func popConfigurationViewController() { dismiss(animated: true) }
    private func validateContent() {
        saveButton.isEnabled = isContentValid()
        for button in options.arrangedSubviews { button.isUserInteractionEnabled = !loading && !finished }
    }
    private func chooseInterestTitle() {
        guard !loading else { return }
        let alert = UIAlertController(title: "Name this saved place", message: "This name appears in Interested. You can use the activity, hotel or restaurant name.", preferredStyle: .alert)
        alert.addTextField { [weak self] field in
            field.text = self?.interestTitle
            field.placeholder = "Name"
            field.autocapitalizationType = .words
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Save name", style: .default) { [weak self, weak alert] _ in
            guard let self else { return }
            do {
                self.interestTitle = try ProviderLinkParser.validatedTitle(alert?.textFields?.first?.text ?? "")
                self.reloadConfigurationItems(); self.validateContent()
            } catch { self.showError(error.localizedDescription) }
        })
        present(alert, animated: true)
    }
    private func chooseMode() {
        let picker = ReelSharePicker(title: "Save as", options: Destination.allCases.map(\.rawValue)) { [weak self] index in
            guard let self else { return }
            self.destination = Destination.allCases[index]
            self.popConfigurationViewController()
            self.reloadConfigurationItems(); self.validateContent()
        }
        pushConfigurationViewController(picker)
    }
    private func chooseBundle() {
        do {
            let bundles = try AppInbox.open().bundles()
            guard !bundles.isEmpty else {
                let alert = UIAlertController(title: "Create your first bundle", message: "Open ReelTrip → Reel Library → Create bundle, then share this reel again. You can also choose Analyse this reel to save it now.", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "OK", style: .default)); present(alert, animated: true); return
            }
            let picker = ReelSharePicker(title: "Choose a bundle", options: bundles.map { $0.name + " · " + String($0.urls.count) + "/12" }) { [weak self] index in
                guard let self else { return }
                self.selectedBundle = bundles[index]
                self.popConfigurationViewController()
                self.reloadConfigurationItems(); self.validateContent()
            }
            pushConfigurationViewController(picker)
        } catch { showError(error.localizedDescription) }
    }
    private func chooseShared() {
        do {
            let buckets = try AppInbox.open().sharedBuckets()
            guard !buckets.isEmpty else {
                let alert = UIAlertController(title: "No shared buckets on this iPhone yet", message: "Open ReelTrip → Shared, then start a group trip or paste the invite link you were sent. Share this reel again afterwards. You can also choose Analyse this reel to save it now.", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "OK", style: .default)); present(alert, animated: true); return
            }
            let picker = ReelSharePicker(title: "Choose a shared bucket", options: buckets.map(\.name)) { [weak self] index in
                guard let self else { return }
                self.selectedShared = buckets[index]
                self.popConfigurationViewController()
                self.reloadConfigurationItems(); self.validateContent()
            }
            pushConfigurationViewController(picker)
        } catch { showError(error.localizedDescription) }
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Save to ReelTrip"
        view.backgroundColor = .systemBackground
        view.tintColor = UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(red: 0.61, green: 0.82, blue: 0.69, alpha: 1) : UIColor(red: 0.15, green: 0.31, blue: 0.26, alpha: 1)
        }
        heading.text = title; heading.font = .preferredFont(forTextStyle: .headline)
        heading.adjustsFontForContentSizeCategory = true; heading.numberOfLines = 0
        let cancel = UIButton(type: .system)
        cancel.setTitle("Cancel", for: .normal)
        cancel.addTarget(self, action: #selector(cancelShare), for: .touchUpInside)
        saveButton.setTitle("Save reel", for: .normal)
        saveButton.addTarget(self, action: #selector(didSelectPost), for: .touchUpInside)
        let header = UIStackView(arrangedSubviews: [cancel, heading, saveButton])
        header.alignment = .center; header.spacing = 12
        heading.setContentHuggingPriority(.defaultLow, for: .horizontal)
        cancel.setContentHuggingPriority(.required, for: .horizontal)
        saveButton.setContentHuggingPriority(.required, for: .horizontal)
        textView.font = .preferredFont(forTextStyle: .body)
        textView.adjustsFontForContentSizeCategory = true
        textView.isEditable = false
        textView.isScrollEnabled = false
        textView.backgroundColor = .clear
        textView.text = "Reading the shared link…"
        options.axis = .vertical; options.spacing = 12
        retryButton.setTitle("Read shared link again", for: .normal)
        retryButton.addTarget(self, action: #selector(retryRead), for: .touchUpInside)
        retryButton.isHidden = true
        for button in [cancel, saveButton, retryButton] {
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        }
        let body = UIStackView(arrangedSubviews: [textView, options, retryButton])
        body.axis = .vertical; body.spacing = 20
        let scroll = UIScrollView()
        for child in [header, scroll] { child.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(child) }
        body.translatesAutoresizingMaskIntoConstraints = false; scroll.addSubview(body)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            header.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            scroll.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 16),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            body.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            body.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -20),
            body.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            body.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            body.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            textView.heightAnchor.constraint(greaterThanOrEqualToConstant: 100)
        ])
        reloadConfigurationItems()
        validateContent()
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if readAttempt == 0 { retryRead() }
    }
    @objc private func cancelShare() {
        guard !finished else { return }
        finished = true; readAttempt += 1
        extensionContext?.completeRequest(returningItems: nil)
    }
    @objc private func retryRead() {
        guard !finished && (readAttempt == 0 || !loading) else { return }
        readAttempt += 1
        let attempt = readAttempt
        loading = true; incomingURLs = []; incomingProvider = nil
        partialRead = false; heading.text = "Save to ReelTrip"
        saveButton.setTitle("Save reel", for: .normal)
        retryButton.isHidden = true; textView.text = "Reading the shared link…"
        reloadConfigurationItems(); validateContent()
        Task { @MainActor in await readAttachments(attempt: attempt) }
    }
    private func isContentValid() -> Bool {
        guard !loading && !finished else { return false }
        if incomingProvider != nil { return (try? ProviderLinkParser.validatedTitle(interestTitle)) != nil }
        return !incomingURLs.isEmpty && (!useBundle || selectedBundle != nil) && (!useShared || selectedShared != nil)
    }
    @objc private func didSelectPost() {
        guard isContentValid() else { return }
        loading = true; retryButton.isHidden = true; validateContent()
        do {
            let store = try AppInbox.open()
            if let provider = incomingProvider {
                try store.saveInterest(provider.url, title: interestTitle)
                loading = true; validateContent()
                complete(title: "Saved for Interested", message: "Open ReelTrip → Interested to see this \(provider.kind). The link is saved on this iPhone, ready to import when ReelTrip opens.")
                return
            }
            let action = try store.share(incomingURLs, to: useBundle ? selectedBundle?.id : nil, openAnalysis: destination == .analyse, sharedBucketId: useShared ? selectedShared?.id : nil)
            if destination == .library {
                loading = true; validateContent()
                complete(title: "Saved to Reel Library", message: "Open ReelTrip whenever you’re ready. Your reel is saved; choose Plan trip to analyse it, or add it to a bundle.")
                return
            }
            loading = true; validateContent(); textView.text = "Saved. Starting background analysis…"
            Task { @MainActor in
                // Only submission happens in the extension. The server owns the long-running job.
                var jobs: [String: String] = [:]
                var accepted = 0
                for url in action.urls {
                    var request = URLRequest(url: SharedLinkParser.website.appendingPathComponent("api/extract"))
                    request.httpMethod = "POST"; request.timeoutInterval = 18
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.httpBody = try? JSONSerialization.data(withJSONObject: ["urls": [url.absoluteString]])
                    do {
                        let configuration = URLSessionConfiguration.ephemeral
                        configuration.timeoutIntervalForResource = 20
                        let session = URLSession(configuration: configuration)
                        defer { session.invalidateAndCancel() }
                        let (data, response) = try await session.data(for: request)
                        guard let response = response as? HTTPURLResponse, response.statusCode == 200, data.count <= 200_000,
                              let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                              let clip = (body["clips"] as? [[String: Any]])?.first,
                              let status = clip["status"] as? String,
                              ["queued", "processing", "analysis_completed", "analysis_cached"].contains(status) else { continue }
                        accepted += 1
                        if let id = clip["jobId"] as? String, UUID(uuidString: id) != nil { jobs[url.absoluteString] = id }
                    } catch { /* Durable share action is retried when the containing app next opens. */ }
                }
                try? store.attachJobs(jobs, to: action.id)
                if let shared = self.selectedShared, self.useShared {
                    // Adding to the group needs this app's member cookie, which only the
                    // ReelTrip app's web view holds. The analysis has already started.
                    self.complete(title: "Saved for \(shared.name)", message: "Open ReelTrip to add it for your group; it’s added as soon as the app opens with a connection. " + (accepted == action.urls.count ? "Finding the places has already started." : "Finding the places will start then."))
                    return
                }
                let message = accepted == action.urls.count ? "Analysis has started on ReelTrip’s servers. You can close this panel; your breakdown will be ready to check in ReelTrip." : "Your reels are saved. Some analyses could not start yet. Open ReelTrip with an internet connection to continue."
                self.complete(title: self.useBundle ? "Added to bundle" : "Reel saved", message: message)
            }
        } catch { loading = false; showError(error.localizedDescription) }
    }
    @MainActor private func readAttachments(attempt: Int) async {
        var fields: [String] = []
        var loaders: [SharedAttachmentReader.Loader] = []
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        guard items.count <= 4 else { loading = false; showError(ShareFailure.tooMany.localizedDescription); return }
        for item in items {
            let providers = item.attachments ?? []
            guard providers.count <= 8 else { loading = false; showError(ShareFailure.tooMany.localizedDescription); return }
            if let text = item.attributedContentText?.string {
                fields.append(text)
            }
            for provider in providers {
                for type in [UTType.url.identifier, UTType.plainText.identifier] where provider.hasItemConformingToTypeIdentifier(type) {
                    loaders.append { done in
                        provider.loadItem(forTypeIdentifier: type, options: nil) { item, _ in
                            if let url = item as? URL { done(url.absoluteString) }
                            else if let text = item as? String { done(text) }
                            else if let data = item as? Data, data.count <= 16_000 { done(String(data: data, encoding: .utf8)) }
                            else { done(nil) }
                        }
                    }
                }
            }
        }
        let result = await SharedAttachmentReader.read(loaders)
        guard !finished && attempt == readAttempt else { return }
        fields.append(contentsOf: result.values)
        // The URL and plain-text representations often contain the exact same link.
        fields = fields.reduce(into: []) { if !$0.contains($1) { $0.append($1) } }
        loading = false
        do {
            switch try SharedInput.parse(fields) {
            case .provider(let provider):
                incomingProvider = provider
                interestTitle = provider.suggestedTitle
                heading.text = "Save to Interested"
                saveButton.setTitle("Save", for: .normal)
                textView.text = "Save this \(provider.kind) to Interested\n\n\(provider.url.absoluteString)\n\nTap Name below to give it a recognisable title. Open ReelTrip after saving to see it in Interested."
            case .reels(let videos):
                incomingURLs = videos
                textView.text = incomingURLs.map(\.absoluteString).joined(separator: "\n\n") + "\n\nTap Save as below to choose Reel Library, Analyse this reel, Add to a bundle or Add to a shared bucket."
            }
            partialRead = result.timedOut
            if partialRead {
                textView.text = "Some shared content did not arrive. Review the links below before saving, or try again. Only these ready links will be saved.\n\n" + textView.text
                saveButton.setTitle("Save ready links", for: .normal)
                retryButton.isHidden = false
            }
            reloadConfigurationItems()
            validateContent()
        } catch {
            incomingProvider = nil; incomingURLs = []
            showError(result.timedOut ? "The sharing app did not finish sending its link. Try again, or copy the reel link and paste it in ReelTrip. Nothing has been saved yet." : error.localizedDescription)
        }
    }
    private func complete(title: String, message: String) {
        guard !finished else { return }
        let detail = message + (partialRead ? " Only the links shown in the share panel were saved; some shared content did not arrive." : "")
        textView.text = title + "\n\n" + detail
        let alert = UIAlertController(title: title, message: detail, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Done", style: .default) { [weak self] _ in self?.cancelShare() })
        present(alert, animated: true)
    }
    private func showError(_ message: String) {
        guard !finished else { return }
        textView.text = message
        retryButton.isHidden = false
        validateContent()
        UIAccessibility.post(notification: .announcement, argument: message)
    }
}

private final class ReelSharePicker: UITableViewController {
    private let options: [String]
    private let onSelect: (Int) -> Void
    init(title: String, options: [String], onSelect: @escaping (Int) -> Void) {
        self.options = options; self.onSelect = onSelect
        super.init(style: .insetGrouped); self.title = title
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { options.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.textLabel?.text = options[indexPath.row]; cell.textLabel?.numberOfLines = 0
        cell.accessibilityTraits.insert(.button); return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) { onSelect(indexPath.row) }
}
