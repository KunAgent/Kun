import AppKit
import ApplicationServices
import Carbon.HIToolbox
import CoreGraphics
import Darwin
import Foundation
import IOKit.pwr_mgt
import LocalAuthentication
import OpenDirectory
import Security

// Feasibility probe for remote auto-unlock; never packaged. It types once, refuses on any doubtful
// session state, and its report holds states and timings only: never the password or its length.

let keychainService = "com.kun.remote-desktop.unlock-probe"
let started = ProcessInfo.processInfo.systemUptime
var events: [[String: Any]] = []
func elapsed() -> Double { (ProcessInfo.processInfo.systemUptime - started).rounded(toPlaces: 2) }
extension Double {
  func rounded(toPlaces places: Int) -> Double {
    let scale = pow(10, Double(places))
    return (self * scale).rounded() / scale
  }
}
func record(_ kind: String, _ value: [String: Any] = [:]) {
  var event = value
  event["t"] = elapsed(); event["kind"] = kind
  events.append(event)
}
func wait(_ seconds: Double) { RunLoop.main.run(until: Date().addingTimeInterval(seconds)) }

func processName(_ pid: Int32) -> String? {
  var buffer = [CChar](repeating: 0, count: 256)
  return proc_name(pid, &buffer, UInt32(buffer.count)) > 0 ? String(cString: buffer) : nil
}

struct SessionState {
  let lockedFlag: Bool?
  let onConsole: Bool?
  let secureInputEnabled: Bool
  let secureInputHolder: String?
  var fields: [String: Any] {
    ["lockedFlag": lockedFlag as Any? ?? NSNull(), "onConsole": onConsole as Any? ?? NSNull(), "secureInputEnabled": secureInputEnabled,
     "secureInputHolder": secureInputHolder as Any? ?? NSNull()]
  }
  /// Nil means every signal says the password field owns the keyboard. Unknown is a refusal.
  var refusal: String? {
    if lockedFlag != true { return "NOT_LOCKED" }
    if onConsole != true { return "NOT_ON_CONSOLE" }
    // The locked flag alone has been seen true with no secure-input holder, so absence is a refusal too.
    if secureInputHolder != "loginwindow" { return "SECURE_INPUT_NOT_LOGINWINDOW" }
    return nil
  }
}
func sessionState() -> SessionState {
  let session = CGSessionCopyCurrentDictionary() as? [String: Any]
  let pid = session?["kCGSSessionSecureInputPID"] as? Int32
  return SessionState(
    lockedFlag: session == nil ? nil : (session?["CGSSessionScreenIsLocked"] as? Bool ?? false),
    onConsole: session?[kCGSessionOnConsoleKey as String] as? Bool,
    secureInputEnabled: IsSecureEventInputEnabled(),
    secureInputHolder: pid.flatMap(processName))
}

// MARK: Keychain

/// Disposable random values stand in for the password: only whether a locked Mac can read them matters.
func keychainQuery(_ dataProtection: Bool) -> [String: Any] {
  var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keychainService,
    kSecAttrAccount as String: dataProtection ? "data-protection" : "file-based"]
  if dataProtection { query[kSecUseDataProtectionKeychain as String] = true }
  return query
}
func keychainDelete() { for mode in [false, true] { SecItemDelete(keychainQuery(mode) as CFDictionary) } }
func keychainWrite() -> [String: Int32] {
  keychainDelete()
  var result: [String: Int32] = [:]
  for mode in [false, true] {
    var attributes = keychainQuery(mode)
    attributes[kSecValueData as String] = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
    if mode { attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly }
    result[mode ? "dataProtection" : "fileBased"] = SecItemAdd(attributes as CFDictionary, nil)
  }
  return result
}
func keychainRead() -> [String: Int32] {
  var result: [String: Int32] = [:]
  for mode in [false, true] {
    var query = keychainQuery(mode)
    query[kSecReturnData as String] = true
    // A prompt on a locked Mac would never be answered, so a read must fail instead of waiting.
    let context = LAContext()
    context.interactionNotAllowed = true
    query[kSecUseAuthenticationContext as String] = context
    result[mode ? "dataProtection" : "fileBased"] = SecItemCopyMatching(query as CFDictionary, nil)
  }
  return result
}

func sample(_ phase: String) {
  var value = sessionState().fields
  value["phase"] = phase
  value["protectedDataAvailable"] = NSApplication.shared.isProtectedDataAvailable
  value["displayAsleep"] = CGDisplayIsAsleep(CGMainDisplayID()) != 0
  value["keychainRead"] = keychainRead()
  record("sample", value)
}

// MARK: Input

func postKey(_ code: CGKeyCode, flags: CGEventFlags = []) {
  for down in [true, false] {
    let event = CGEvent(keyboardEventSource: CGEventSource(stateID: .hidSystemState), virtualKey: code, keyDown: down)
    event?.flags = flags
    event?.post(tap: .cghidEventTap)
  }
}
func postCharacter(_ units: [UniChar]) {
  // A Unicode payload does not depend on the Mac's keyboard layout or input source.
  for down in [true, false] {
    let event = CGEvent(keyboardEventSource: CGEventSource(stateID: .hidSystemState), virtualKey: 0, keyDown: down)
    event?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
    event?.post(tap: .cghidEventTap)
  }
}
/// Rechecks before every key so an unlock mid-way cannot spill the rest into an ordinary app.
func typeGuarded(_ characters: [Character]) -> [String: Any] {
  var posted = 0
  for character in characters {
    if let refusal = sessionState().refusal { return ["posted": posted, "refused": refusal] }
    postCharacter(Array(String(character).utf16))
    posted += 1
    wait(0.04)
  }
  if let refusal = sessionState().refusal { return ["posted": posted, "refused": refusal] }
  postKey(CGKeyCode(kVK_Return))
  return ["posted": posted, "submitted": true]
}

// MARK: Commands

func writeReport(_ path: String?, _ value: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
  if let path { FileManager.default.createFile(atPath: path, contents: data, attributes: [.posixPermissions: 0o600]) }
  else { print(String(data: data, encoding: .utf8)!) }
}
func environment() -> [String: Any] {
  ["os": ProcessInfo.processInfo.operatingSystemVersionString, "accessibility": AXIsProcessTrusted(), "screenCapture": CGPreflightScreenCaptureAccess()]
}
func preflight(_ reportPath: String?) {
  let written = keychainWrite(), read = keychainRead()
  keychainDelete()
  // Read-only: preflight must never post a key, whatever the session state turns out to be.
  writeReport(reportPath, ["environment": environment(), "state": sessionState().fields, "keychainWrite": written, "keychainRead": read,
    "guardDecision": sessionState().refusal ?? "WOULD_TYPE"])
}
func readPassword() -> [Character]? {
  guard let raw = getpass("Mac 登录密码（只留在本进程内存，用完即弃）：") else { return nil }
  defer { memset(raw, 0, strlen(raw)) }
  let value = Array(String(cString: raw))
  return value.isEmpty ? nil : value
}
func passwordIsCorrect(_ characters: [Character]) -> Bool {
  // A wrong password must never reach the lock screen, where failures add login delays.
  guard let node = try? ODNode(session: ODSession.default(), type: ODNodeType(kODNodeTypeLocalNodes)),
    let user = try? node.record(withRecordType: kODRecordTypeUsers, name: NSUserName(), attributes: nil) else { return false }
  return (try? user.verifyPassword(String(characters))) != nil
}
func waitForLockFlag(_ expected: Bool, timeout: Double) -> Double? {
  let begin = elapsed()
  while elapsed() - begin < timeout {
    if sessionState().lockedFlag == expected { return (elapsed() - begin).rounded(toPlaces: 2) }
    wait(0.1)
  }
  return nil
}
func observeLockNotifications() {
  let distributed = DistributedNotificationCenter.default()
  for name in ["com.apple.screenIsLocked", "com.apple.screenIsUnlocked"] {
    distributed.addObserver(forName: Notification.Name(name), object: nil, queue: .main) { _ in record("notification", ["name": name]) }
  }
  for name in ["NSApplicationProtectedDataDidBecomeAvailableNotification", "NSApplicationProtectedDataWillBecomeUnavailableNotification"] {
    NotificationCenter.default.addObserver(forName: Notification.Name(name), object: nil, queue: .main) { _ in record("notification", ["name": name]) }
  }
}
func run(_ reportPath: String) {
  guard AXIsProcessTrusted() else {
    print("当前终端没有“辅助功能”权限：请到 系统设置 → 隐私与安全性 → 辅助功能 打开后重试。电脑未被锁定。"); exit(3)
  }
  guard sessionState().lockedFlag == false, sessionState().refusal == "NOT_LOCKED" else { print("当前会话状态异常，已放弃。"); exit(3) }
  guard let password = readPassword() else { print("没有读到密码，已放弃。"); exit(3) }
  guard passwordIsCorrect(password) else { print("密码校验未通过，已放弃，电脑未被锁定。"); exit(4) }
  print("""

  按回车后电脑会锁屏。约 30 秒内屏幕会熄灭再亮起，然后自动输入密码解锁。
  期间请不要碰键盘鼠标。如果最后没解开，手动输入密码即可，脚本只会尝试一次。
  """)
  _ = readLine()

  let report: () -> Void = {
    keychainDelete()
    writeReport(reportPath, ["environment": environment(), "events": events])
  }
  observeLockNotifications()
  _ = NSApplication.shared.setActivationPolicy(.prohibited)
  record("keychainWrite", ["status": keychainWrite()])
  sample("before-lock")

  postKey(CGKeyCode(kVK_ANSI_Q), flags: [.maskCommand, .maskControl])
  let lockedAfter = waitForLockFlag(true, timeout: 5)
  record("lockShortcut", ["lockedAfterSeconds": lockedAfter as Any? ?? NSNull()])
  if lockedAfter == nil {
    print("快捷键没有锁屏。请在 15 秒内手动锁屏（Ctrl+Cmd+Q 或菜单），否则脚本放弃。")
    let manual = waitForLockFlag(true, timeout: 15)
    record("manualLock", ["lockedAfterSeconds": manual as Any? ?? NSNull()])
    if manual == nil { report(); print("没有检测到锁屏，已放弃。"); exit(5) }
  }

  for _ in 0..<8 { wait(1); sample("locked-display-on") }

  let displayOff = Process()
  displayOff.executableURL = URL(fileURLWithPath: "/usr/bin/pmset")
  displayOff.arguments = ["displaysleepnow"]
  do { try displayOff.run(); displayOff.waitUntilExit() } catch { record("displaySleepFailed") }
  for _ in 0..<8 { wait(1); sample("locked-display-off") }

  var assertion = IOPMAssertionID(0)
  let woke = IOPMAssertionDeclareUserActivity("Kun unlock probe" as CFString, kIOPMUserActiveLocal, &assertion)
  let wakeBegin = elapsed()
  while CGDisplayIsAsleep(CGMainDisplayID()) != 0 && elapsed() - wakeBegin < 4 { wait(0.1) }
  record("wake", ["status": woke, "awakeAfterSeconds": (elapsed() - wakeBegin).rounded(toPlaces: 2), "displayAsleep": CGDisplayIsAsleep(CGMainDisplayID()) != 0])
  wait(0.8)
  sample("before-typing")

  // A dark lock screen has no secure-input holder until a key wakes it, so Esc needs only the lock flags.
  let beforeEscape = sessionState()
  if beforeEscape.lockedFlag == true && beforeEscape.onConsole == true { postKey(CGKeyCode(kVK_Escape)); wait(1) }
  sample("after-escape")
  let typingBegin = elapsed()
  let typing = typeGuarded(password)
  record("typing", typing)
  let unlockedAfter = typing["submitted"] != nil ? waitForLockFlag(false, timeout: 10) : nil
  record("unlock", ["unlockedAfterSubmitSeconds": unlockedAfter as Any? ?? NSNull(), "totalSeconds": (elapsed() - typingBegin).rounded(toPlaces: 2)])
  sample("after-unlock-attempt")
  record("guardAfterAttempt", ["decision": sessionState().refusal ?? "WOULD_TYPE"])
  IOPMAssertionRelease(assertion)
  report()
}

keychainDelete()
let arguments = Array(CommandLine.arguments.dropFirst())
switch arguments.first {
case "preflight": preflight(arguments.count > 1 ? arguments[1] : nil)
case "run" where arguments.count == 2: run(arguments[1])
default: print("usage: macos-unlock-probe preflight [report.json] | run <report.json>"); exit(2)
}
