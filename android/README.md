# android — reserved, deliberately empty

Brief 0066 / ADR-0007 D10. v1 is **iOS only**.

Android is not blocked by effort but by a security question nobody has
answered yet: Android permissions are granted per **UID**, not per process,
and a `WebView` cannot run in an `isolatedProcess` — so a WebView in the
Spiral app always holds `INTERNET`. On iOS the same untrusted code runs in a
separate WebContent process and every byte is served by a
`WKURLSchemeHandler`, so "no network" can be enforced structurally. On
Android it would rest on CSP plus `shouldInterceptRequest` alone.

That is not a reason to ship a weaker version quietly. Until the isolation
question has a measured answer, Android does not run generated code at all.

## What Android does in v1

It renders a **read-only native card**, with no runtime and no WebView:

- read the `com.spiral.app` post for `title`;
- read the most recent related `com.spiral.app.action` for `summary.line`;
- draw a native card and say the interactive part is on iOS.

This works because every action carries a `summary` the native side can
render without executing anything (ADR-0007 § 5.2). It was designed for
snapshots and notifications; Android's read-only mode is the same field.

## When this directory gets filled

A Gradle module carrying the same `dist/` output as `ios/`, plus:

- `shouldInterceptRequest` returning an explicit **deny** response for
  anything outside the artifact — today `WebViewWidgetMessageInterceptor.kt`
  returns `null`, which *permits* the request;
- `WebViewCompat.addWebMessageListener` scoped to the shell origin, not
  `"*"`;
- `allowFileAccess` / `allowContentAccess` / `domStorageEnabled` off;
- the pool hoisted out of the `LazyColumn`, since composable rows are
  recycled exactly like iOS cells.

None of that is worth writing before the isolation question is settled.
