// swift-tools-version: 6.0
//
// Copyright 2026 the Spiral authors. AGPL-3.0-or-later.
//
// Brief 0066 / ADR-0007. SwiftPM wrapper carrying the built shell + runtime.
//
// Same shape the retired `element-call-swift` used: an almost-empty target
// whose only job is to carry `Sources/dist` into the app bundle as a resource,
// consumed by `agent-x-ios` as a sibling path dependency.
//
// `Sources/dist` is generated — run `pnpm build:ios` in the repository root,
// never hand-edit it.
//
// This is NOT a restoration of `EmbeddedElementCall` (see the note in
// `agent-x-ios/project.yml`). That package embedded a call stack that
// competed with CallKit for media ownership; ADR-0079 removed it for good
// reasons that do not apply here. This package carries the only execution
// environment untrusted generated UI can run in.

import PackageDescription

let package = Package(
    name: "SpiralAppShell",
    platforms: [.iOS(.v17)],
    products: [
        .library(
            name: "SpiralAppShell",
            targets: ["SpiralAppShell"]),
        // Test targets only: the first-party artifacts never ship in an app.
        .library(
            name: "SpiralAppTestArtifacts",
            targets: ["SpiralAppTestArtifacts"]),
    ],
    targets: [
        .target(
            name: "SpiralAppShell",
            resources: [.copy("../dist")]),
        .target(
            name: "SpiralAppTestArtifacts",
            resources: [.copy("artifacts")]),
    ]
)
