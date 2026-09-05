import AppKit
import CoreGraphics
import Foundation

let bundlePath = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath().path
let executablePath = URL(fileURLWithPath: CommandLine.arguments[2]).resolvingSymlinksInPath().path
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []
let applications: [[String: Any]] = NSWorkspace.shared.runningApplications.compactMap { app in
    guard !app.isTerminated, app.isFinishedLaunching,
          app.activationPolicy != .prohibited,
          app.bundleURL?.resolvingSymlinksInPath().path == bundlePath,
          app.executableURL?.resolvingSymlinksInPath().path == executablePath else { return nil }
    let visibleWindow = windows.contains { window in
        guard let pid = window[kCGWindowOwnerPID as String] as? Int,
              let layer = window[kCGWindowLayer as String] as? Int,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let width = bounds["Width"] as? Double,
              let height = bounds["Height"] as? Double else { return false }
        return pid == Int(app.processIdentifier) && layer == 0 && width > 0 && height > 0
    }
    return ["pid": Int(app.processIdentifier), "bundleId": app.bundleIdentifier ?? "",
            "bundlePath": bundlePath, "executablePath": executablePath,
            "finishedLaunching": app.isFinishedLaunching, "guiWindowObserved": visibleWindow]
}
let data = try JSONSerialization.data(withJSONObject: applications, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
