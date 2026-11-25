import UIKit

@main final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "ReelTrip", sessionRole: session.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.tintColor = UIColor(red: 0.15, green: 0.31, blue: 0.26, alpha: 1)
        window.rootViewController = UINavigationController(rootViewController: PlannerViewController())
        self.window = window
        window.makeKeyAndVisible()
    }
    func sceneDidBecomeActive(_ scene: UIScene) {
        (window?.rootViewController as? UINavigationController)?.viewControllers
            .compactMap { $0 as? PlannerViewController }.first?.refreshLibrary()
    }
}
