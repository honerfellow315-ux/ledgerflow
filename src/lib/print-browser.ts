/**
 * Detects whether the current browser needs the Safari-safe print layout
 * instead of the normal one (InvoiceDocument, SubcontractDocument,
 * StatementDocument).
 *
 * The normal print layout anchors the letterhead image with
 * `position: fixed; top: 0; left: 0` (see `.id-letterhead-bg` /
 * `.sd-letterhead-bg` in styles.css) and relies on the browser repainting
 * that fixed element on every printed page. Chrome, Edge and Firefox all do
 * this. WebKit's print engine does not — a `position: fixed` element only
 * ever shows up on the FIRST printed page — so on Safari the letterhead
 * silently disappears from page 2 onward and the layout looks broken.
 *
 * This is not a "Safari the app" problem, it's a WebKit-the-engine problem:
 * Apple requires every browser on iOS/iPadOS (Chrome, Firefox, Edge, etc.)
 * to be built on WebKit, so they all inherit the same print bug. That's why
 * this checks for iOS in general, not just Safari's user-agent string.
 *
 * Do not use this to change anything about the normal (Chrome-workflow)
 * print layout — it only decides which document component gets rendered.
 */
export function shouldUseSafariPrintLayout(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;

  // iOS/iPadOS: every browser there is a WebKit skin, so treat all of them
  // as needing the Safari-safe layout. iPadOS 13+ reports its UA as a Mac,
  // so we also catch that case via touch support on "MacIntel".
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (typeof navigator.maxTouchPoints === "number" &&
      navigator.platform === "MacIntel" &&
      navigator.maxTouchPoints > 1);
  if (isIOS) return true;

  // Desktop Safari. Every other browser's UA also contains the word
  // "Safari" (Chrome, Edge, Android WebView, etc. are all WebKit/Blink
  // descendants), so this excludes anything that also identifies as one of
  // those.
  const isDesktopSafari = /^((?!chrome|crios|fxios|edg|android).)*safari/i.test(ua);
  return isDesktopSafari;
}
