//
// Copyright 2026 the Spiral authors. AGPL-3.0-or-later.
//
// Brief 0066 / ADR-0007. Locations inside the shipped bundle.
//
// The bundle carries the shell and the runtime only. The first-party test
// artifacts (the spike's hostile probe, the counter, the conformance harness,
// the lab and motion pages) are in the `SpiralAppTestArtifacts` product, which
// only test targets link: App Review 2.5.19, no dormant code in the app.
//
// The host never loads these by file URL. It serves them through a
// `WKURLSchemeHandler` registered for `spiral-app://`, so that every byte the
// WebView sees is one this package deliberately handed over — and an
// artifact's document is synthesised rather than read from disk, which is
// what stops a generated app from controlling its own `<head>`.
//

import Foundation

public enum SpiralAppShell {
    /// Bundle carrying the built `dist` tree.
    public static let bundle = Bundle.module

    /// Version of the shell + runtime pair. Bumped when `dist` is rebuilt;
    /// an artifact's `runtime` field is matched against ``runtimeVersion``,
    /// not against this.
    public static let version = "1.0.2"

    /// Runtime contract an artifact declares in its manifest. A post asking
    /// for a version this build does not carry renders as a native "update
    /// to open" card instead of executing anything.
    public static let runtimeVersion = "1"

    /// The trusted shell document. A real file, because it is ours.
    public static var shellDocumentURL: URL? {
        bundle.url(forResource: "shell", withExtension: "html", subdirectory: "dist")
    }

    /// Script the shell document loads. Served under the shell origin.
    public static var shellScriptURL: URL? {
        bundle.url(forResource: "shell", withExtension: "js", subdirectory: "dist")
    }

    /// Bootstrap that runs inside the sandboxed frame: hardens the realm,
    /// takes the `MessagePort`, transpiles the artifact and mounts it.
    public static var runtimeBootstrapURL: URL? {
        bundle.url(forResource: "runtime-v1-bootstrap", withExtension: "js", subdirectory: "dist")
    }

    /// React and the JSX runtime, shared by every artifact on runtime v1.
    public static var runtimeReactURL: URL? {
        bundle.url(forResource: "runtime-v1-react", withExtension: "js", subdirectory: "dist")
    }

    /// `@spiral/sdk`: the app's only way to read and change shared state.
    ///
    /// Ships here rather than inside an artifact for the same reason React
    /// does — one implementation per `runtimeVersion`, so a post cannot
    /// bring its own fold and disagree with everyone else's.
    public static var runtimeSdkURL: URL? {
        bundle.url(forResource: "runtime-v1-sdk", withExtension: "js", subdirectory: "dist")
    }

    /// The UI kit an app imports as `@spiral/ui`.
    public static var runtimeUiURL: URL? {
        bundle.url(forResource: "runtime-v1-ui", withExtension: "js", subdirectory: "dist")
    }

    /// Motion, gestures and stroke geometry, imported as `@spiral/play`.
    ///
    /// Third-party code, bundled into the RUNTIME rather than into artifacts:
    /// a frame has no network, so anything a generated post imports has to be
    /// on our origin already. React is external here like everywhere else —
    /// a second copy is an "invalid hook call", not a size problem.
    public static var runtimePlayURL: URL? {
        bundle.url(forResource: "runtime-v1-play", withExtension: "js", subdirectory: "dist")
    }

    /// Compound's design tokens and the kit's rules, in one file.
    ///
    /// Linked from the synthesised document rather than injected by the kit,
    /// so an app is styled before its first paint instead of flashing
    /// unstyled — and so the `<head>` stays the host's to decide.
    public static var runtimeUiStylesheetURL: URL? {
        bundle.url(forResource: "runtime-v1-ui", withExtension: "css", subdirectory: "dist")
    }

    /// Maps a path from a `spiral-app://` request to a file in this bundle.
    /// Returns `nil` for anything not deliberately published, so the scheme
    /// handler's default is refusal.
    ///
    /// - Parameter path: request path, e.g. `/runtime/v1/react.js`.
    public static func bundledResource(forPath path: String) -> URL? {
        switch path {
        case "/shell/index.html", "/index.html":
            return shellDocumentURL
        case "/shell/shell.js", "/shell.js":
            return shellScriptURL
        case "/runtime/v1/bootstrap.js":
            return runtimeBootstrapURL
        case "/runtime/v1/react.js":
            return runtimeReactURL
        case "/runtime/v1/sdk.js":
            return runtimeSdkURL
        case "/runtime/v1/ui.js":
            return runtimeUiURL
        case "/runtime/v1/play.js":
            return runtimePlayURL
        case "/runtime/v1/ui.css":
            return runtimeUiStylesheetURL
        default:
            return nil
        }
    }
}
