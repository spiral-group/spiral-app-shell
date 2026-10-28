//
// Copyright 2026 the Spiral authors. AGPL-3.0-or-later.
//
// Brief 0066 / ADR-0007. The first-party artifacts the client's tests mount.
//
// A separate product so they never enter the app bundle (App Review 2.5.19):
// only test targets link it. Nothing here is reachable through
// `SpiralAppShell.bundledResource(forPath:)`.
//

import Foundation

public enum SpiralAppTestArtifacts {
    /// Bundle carrying `artifacts/`.
    public static let bundle = Bundle.module

    /// A packed first-party artifact and the digest of its bytes.
    ///
    /// The digest is read from disk rather than recomputed so the client and
    /// the packer cannot drift: if they disagree, the mount refuses, which is
    /// exactly what it should do.
    public struct PackedArtifact: Sendable {
        public let bytes: Data
        public let digest: String
    }

    /// The hostile probe of the Brief 0066 runtime spike.
    public static var probe: PackedArtifact? { packed("probe") }

    /// The step 5.1 counter: one button, one number, one `incr`.
    public static var counter: PackedArtifact? { packed("counter") }

    /// App 0, the conformance harness (Brief 0066 § 5.9). It WRITES to the
    /// post it is mounted against.
    public static var conformance: PackedArtifact? { packed("conformance") }

    /// Step 6.11, the layout lab: every pattern the generator is taught.
    public static var lab: PackedArtifact? { packed("lab") }

    /// Step 6.10, the motion and layout probe.
    public static var motion: PackedArtifact? { packed("motion") }

    private static func packed(_ name: String) -> PackedArtifact? {
        guard let container = bundle.url(forResource: name, withExtension: "spiralapp", subdirectory: "artifacts"),
              let digestFile = bundle.url(forResource: name, withExtension: "sha256", subdirectory: "artifacts"),
              let bytes = try? Data(contentsOf: container),
              let digest = try? String(contentsOf: digestFile, encoding: .utf8) else {
            return nil
        }
        return PackedArtifact(bytes: bytes, digest: digest.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}
