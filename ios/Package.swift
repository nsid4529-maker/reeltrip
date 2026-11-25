// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "ReelTripCore", platforms: [.macOS(.v13), .iOS(.v16)], products: [.library(name: "ReelTripCore", targets: ["ReelTripCore"])], targets: [.target(name: "ReelTripCore"), .testTarget(name: "ReelTripCoreTests", dependencies: ["ReelTripCore"])])
