// Spike: a native macOS shell for Oriel. It runs the same Node server as a
// child process, learns its port from the server's first line, and opens a
// WKWebView on it. No package manager, no third-party code.
//
// ORIEL_NODE: the node binary. ORIEL_MAIN: packages/server/src/main.ts.
// ORIEL_USABLE: a file to write the time the overview first rendered to.
import AppKit
import WebKit

final class Shell: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  var window: NSWindow!
  var web: WKWebView!
  let server = Process()
  var buffered = ""

  func applicationDidFinishLaunching(_ note: Notification) {
    let env = ProcessInfo.processInfo.environment
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
      styleMask: [.titled, .closable, .resizable, .miniaturizable],
      backing: .buffered, defer: false)
    window.title = "Oriel"
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    web = WKWebView(frame: window.contentView!.bounds, configuration: config)
    web.autoresizingMask = [.width, .height]
    web.navigationDelegate = self
    window.contentView!.addSubview(web)
    window.center()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)

    server.executableURL = URL(fileURLWithPath: env["ORIEL_NODE"]!)
    server.arguments = [env["ORIEL_MAIN"]!, "--port", "0", "--fresh", "desktop-spike"]
    let out = Pipe()
    server.standardOutput = out
    out.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty, let self else { return }
      self.buffered += String(decoding: data, as: UTF8.self)
      guard let range = self.buffered.range(of: #"running at (http://127\.0\.0\.1:\d+/)"#, options: .regularExpression)
      else { return }
      let url = URL(string: String(self.buffered[range].dropFirst("running at ".count)))!
      handle.readabilityHandler = nil
      DispatchQueue.main.async { self.web.load(URLRequest(url: url)) }
    }
    try! server.run()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { poll() }

  // Usable: the overview has rendered its columns.
  func poll() {
    web.evaluateJavaScript("document.querySelector('.overview-columns') !== null") { [weak self] value, _ in
      guard let self else { return }
      if (value as? Bool) == true {
        let usable = ProcessInfo.processInfo.environment["ORIEL_USABLE"]
        if let usable { try? "\(Date().timeIntervalSince1970)".write(toFile: usable, atomically: true, encoding: .utf8) }
        return
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) { self.poll() }
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ note: Notification) {
    server.terminate()
    server.waitUntilExit()
  }
}

let app = NSApplication.shared
let shell = Shell()
app.delegate = shell
app.setActivationPolicy(.regular)
app.run()
