// swift-tools-version: 6.0
//
// Copyright 2026 the Spiral authors. AGPL-3.0-or-later.
//
// The same package as ios/Package.swift, at the repository root, so that
// the iOS app can depend on this repository by URL and version: SwiftPM
// reads a remote package's manifest from the root only. A sibling checkout
// keeps using ios/ by path.

import PackageDescription

let package = Package(
    name: "SpiralAppShell",
    platforms: [.iOS(.v17)],
    products: [
        .library(
            name: "SpiralAppShell",
            targets: ["SpiralAppShell"]),
    ],
    targets: [
        .target(
            name: "SpiralAppShell",
            path: "ios/Sources/SpiralAppShell",
            resources: [.copy("../dist")]),
    ]
)
