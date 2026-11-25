import Foundation
import CoreGraphics
import ApplicationServices
import Carbon.HIToolbox
import IOKit.pwr_mgt
import OpenDirectory
import Darwin

// Owned by one Main session. stdin EOF, lost parent or a nonrenewed lease releases input.
let parent = getppid()
let gate = NSLock()
var deadline = ProcessInfo.processInfo.systemUptime + 15
var setupLeaseAllowed = true
var capturePid: Int32 = 0
var captureBirth = ""
var display: CGDirectDisplayID = CGMainDisplayID()
var heldKeys = Set<CGKeyCode>()
var heldButtons = Set<Int>()
var lastPoint = CGPoint.zero
var clickTimes: [Int: Double] = [:]
var clickPoints: [Int: CGPoint] = [:]
var clickCounts: [Int: Int64] = [:]
let letterKeys: [String: CGKeyCode] = ["KeyA":0,"KeyS":1,"KeyD":2,"KeyF":3,"KeyH":4,"KeyG":5,"KeyZ":6,"KeyX":7,"KeyC":8,"KeyV":9,"KeyB":11,"KeyQ":12,"KeyW":13,"KeyE":14,"KeyR":15,"KeyY":16,"KeyT":17,"Digit1":18,"Digit2":19,"Digit3":20,"Digit4":21,"Digit6":22,"Digit5":23,"Equal":24,"Digit9":25,"Digit7":26,"Minus":27,"Digit8":28,"Digit0":29,"BracketRight":30,"KeyO":31,"KeyU":32,"BracketLeft":33,"KeyI":34,"KeyP":35,"Enter":36,"KeyL":37,"KeyJ":38,"Quote":39,"KeyK":40,"Semicolon":41,"Backslash":42,"Comma":43,"Slash":44,"KeyN":45,"KeyM":46,"Period":47,"Tab":48,"Space":49,"Backquote":50,"Backspace":51,"Escape":53,"MetaLeft":55,"ShiftLeft":56,"AltLeft":58,"ControlLeft":59,"ArrowLeft":123,"ArrowRight":124,"ArrowDown":125,"ArrowUp":126,"Delete":117,"Home":115,"End":119,"PageUp":116,"PageDown":121]
let keyMap = letterKeys.merging([
  "Minus":27,"Equal":24,"BracketLeft":33,"BracketRight":30,"Backslash":42,"Semicolon":41,"Quote":39,
  "Backquote":50,"Comma":43,"Period":47,"Slash":44,"CapsLock":57,"MetaRight":54,"ShiftRight":60,
  "AltRight":61,"ControlRight":62,"Insert":114,"NumpadDecimal":65,"NumpadMultiply":67,"NumpadAdd":69,
  "NumpadDivide":75,"NumpadEnter":76,"NumpadSubtract":78,"Numpad0":82,"Numpad1":83,"Numpad2":84,
  "Numpad3":85,"Numpad4":86,"Numpad5":87,"Numpad6":88,"Numpad7":89,"Numpad8":91,"Numpad9":92,
  "F1":122,"F2":120,"F3":99,"F4":118,"F5":96,"F6":97,"F7":98,"F8":100,"F9":101,"F10":109,
  "F11":103,"F12":111,"F13":105,"F14":107,"F15":113,"F16":106,"F17":64,"F18":79,"F19":80,"F20":90
], uniquingKeysWith: { first, _ in first })
func currentLockState() -> String {
  guard let info = CGSessionCopyCurrentDictionary() as? [String: Any],
    info[kCGSessionOnConsoleKey as String] as? Bool == true,
    info[kCGSessionLoginDoneKey as String] as? Bool == true else { return "inactive" }
  return info["CGSSessionScreenIsLocked"] as? Bool == true ? "locked" : "unlocked"
}
func interactiveSession() -> Bool {
  return currentLockState() == "unlocked"
}
func processExecutableName(_ pid: Int32) -> String? {
  var buffer = [CChar](repeating: 0, count: 256)
  return proc_name(pid, &buffer, UInt32(buffer.count)) > 0 ? String(cString: buffer) : nil
}
func loginwindowOwnsSecureInput() -> Bool {
  guard let info = CGSessionCopyCurrentDictionary() as? [String: Any],
    info[kCGSessionOnConsoleKey as String] as? Bool == true,
    info[kCGSessionLoginDoneKey as String] as? Bool == true,
    info["CGSSessionScreenIsLocked"] as? Bool == true,
    IsSecureEventInputEnabled(),
    let pid = info["kCGSSessionSecureInputPID"] as? Int32,
    processExecutableName(pid) == "loginwindow" else { return false }
  return true
}
func verifyMacPassword(_ password: String) -> Bool {
  let user = NSUserName()
  guard !user.isEmpty else { return false }
  for nodeType in [ODNodeType(kODNodeTypeLocalNodes), ODNodeType(kODNodeTypeAuthentication)] {
    if let node = try? ODNode(session: ODSession.default(), type: nodeType),
       let record = try? node.record(withRecordType: kODRecordTypeUsers, name: user, attributes: nil) {
      return (try? record.verifyPassword(password)) != nil
    }
  }
  return false
}
func postLockScreenKey(_ code: CGKeyCode, flags: CGEventFlags = []) -> Bool {
  for down in [true, false] {
    guard let source = CGEventSource(stateID: .hidSystemState),
      let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { return false }
    event.flags = flags
    event.post(tap: .cghidEventTap)
  }
  return true
}
func unlockReply(_ error: String? = nil) -> Never {
  let payload: [String: Any] = error == nil ? ["ok": true] : ["ok": false, "error": error!]
  if let data = try? JSONSerialization.data(withJSONObject: payload), let line = String(data: data, encoding: .utf8) {
    print(line); fflush(stdout)
  }
  exit(0)
}
func runUnlockFromStdin() -> Never {
  guard var line = readLine(), line.utf8.count <= 4096, var raw = line.data(using: .utf8) else {
    unlockReply("INVALID_REQUEST")
  }
  defer {
    raw.resetBytes(in: 0..<raw.count)
    line.removeAll(keepingCapacity: false)
  }
  guard let json = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any],
    Set(json.keys) == Set(["password"]),
    var password = json["password"] as? String,
    !password.isEmpty, password.utf8.count <= 256, !password.contains("\0") else {
    unlockReply("INVALID_REQUEST")
  }
  defer { password.removeAll(keepingCapacity: false) }
  let initial = currentLockState()
  if initial == "inactive" { unlockReply("DESKTOP_HOST_INACTIVE") }
  guard AXIsProcessTrusted() else { unlockReply("INPUT_PERMISSION_REQUIRED") }
  // Verify against OpenDirectory before touching loginwindow so wrong passwords never trigger OS lockouts.
  guard verifyMacPassword(password) else { unlockReply("DESKTOP_UNLOCK_DENIED") }
  let afterVerify = currentLockState()
  if afterVerify == "inactive" { unlockReply("DESKTOP_HOST_INACTIVE") }
  if afterVerify == "unlocked" { unlockReply() }

  var assertion = IOPMAssertionID(0)
  let declared = IOPMAssertionDeclareUserActivity("Kun remote unlock" as CFString, kIOPMUserActiveLocal, &assertion)
  defer { if declared == kIOReturnSuccess { IOPMAssertionRelease(assertion) } }
  let wakeBegin = ProcessInfo.processInfo.systemUptime
  while CGDisplayIsAsleep(CGMainDisplayID()) != 0 && ProcessInfo.processInfo.systemUptime - wakeBegin < 3.0 {
    usleep(50_000)
  }
  for _ in 0..<8 where !loginwindowOwnsSecureInput() && currentLockState() == "locked" {
    usleep(50_000)
  }
  if !loginwindowOwnsSecureInput() && currentLockState() == "locked" {
    _ = postLockScreenKey(53)
    let focusBegin = ProcessInfo.processInfo.systemUptime
    while !loginwindowOwnsSecureInput() && currentLockState() == "locked" && ProcessInfo.processInfo.systemUptime - focusBegin < 2.0 {
      usleep(50_000)
    }
  }
  if !loginwindowOwnsSecureInput() {
    unlockReply(currentLockState() == "unlocked" ? nil : "DESKTOP_UNLOCK_UNAVAILABLE")
  }
  // Clear any stray characters already sitting in the lock-screen field before typing.
  if loginwindowOwnsSecureInput() {
    _ = postLockScreenKey(0, flags: .maskCommand)
    usleep(20_000)
    if loginwindowOwnsSecureInput() { _ = postLockScreenKey(51); usleep(30_000) }
  }
  for character in password {
    guard AXIsProcessTrusted(), loginwindowOwnsSecureInput() else {
      unlockReply(currentLockState() == "unlocked" ? nil : "DESKTOP_UNLOCK_INTERRUPTED")
    }
    let units = Array(String(character).utf16)
    for down in [true, false] {
      guard let source = CGEventSource(stateID: .hidSystemState),
        let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down) else {
        unlockReply("DESKTOP_UNLOCK_FAILED")
      }
      event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
      event.post(tap: .cghidEventTap)
    }
    usleep(30_000)
  }
  guard AXIsProcessTrusted(), loginwindowOwnsSecureInput() else {
    unlockReply(currentLockState() == "unlocked" ? nil : "DESKTOP_UNLOCK_INTERRUPTED")
  }
  guard postLockScreenKey(36) else { unlockReply("DESKTOP_UNLOCK_FAILED") }
  let waitBegin = ProcessInfo.processInfo.systemUptime
  while ProcessInfo.processInfo.systemUptime - waitBegin < 6.0 {
    let state = currentLockState()
    if state == "unlocked" { unlockReply() }
    if state == "inactive" { unlockReply("DESKTOP_HOST_INACTIVE") }
    usleep(100_000)
  }
  unlockReply(currentLockState() == "unlocked" ? nil : "DESKTOP_UNLOCK_FAILED")
}
func flags(excluding released: CGKeyCode? = nil) -> CGEventFlags {
  var value = CGEventFlags()
  let active = heldKeys.filter { $0 != released }
  if active.contains(55) || active.contains(54) { value.insert(.maskCommand) }
  if active.contains(56) || active.contains(60) { value.insert(.maskShift) }
  if active.contains(58) || active.contains(61) { value.insert(.maskAlternate) }
  if active.contains(59) || active.contains(62) { value.insert(.maskControl) }
  return value
}
func postKey(_ code: CGKeyCode, _ down: Bool) {
  if down { heldKeys.insert(code) } else { heldKeys.remove(code) }
  let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
  event?.flags = flags(); event?.post(tap: .cghidEventTap)
}
func mouseButton(_ button: Int) -> CGMouseButton {
  return button == 0 ? .left : button == 2 ? .right : .center
}
func releaseAll() -> Bool {
  if heldKeys.isEmpty && heldButtons.isEmpty { return true }
  guard AXIsProcessTrusted() else { return false }
  for code in Array(heldKeys) {
    guard AXIsProcessTrusted(), let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else { return false }
    event.flags = flags(excluding: code); event.post(tap: .cghidEventTap)
    heldKeys.remove(code)
  }
  for button in Array(heldButtons) {
    guard AXIsProcessTrusted() else { return false }
    let type: CGEventType = button == 0 ? .leftMouseUp : button == 2 ? .rightMouseUp : .otherMouseUp
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: lastPoint, mouseButton: mouseButton(button)) else { return false }
    event.flags = flags(); event.post(tap: .cghidEventTap)
    heldButtons.remove(button)
  }
  return true
}
func processInfo(_ pid: Int32) -> proc_bsdinfo? {
  var info = proc_bsdinfo()
  let size = Int32(MemoryLayout<proc_bsdinfo>.size)
  return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size ? info : nil
}
func birth(_ pid: Int32) -> String {
  guard let info = processInfo(pid) else { return "" }
  return "\(info.pbi_start_tvsec):\(info.pbi_start_tvusec)"
}
func ownedCapture(_ pid: Int32, _ expected: String) -> Bool {
  guard pid > 1, pid != parent, pid != getpid(), !expected.isEmpty,
    let first = processInfo(pid), first.pbi_uid == getuid(), birth(pid) == expected else { return false }
  var ancestor = Int32(first.pbi_ppid)
  for _ in 0..<8 {
    if ancestor == parent { return true }
    guard ancestor > 1, let info = processInfo(ancestor), info.pbi_uid == getuid() else { return false }
    ancestor = Int32(info.pbi_ppid)
  }
  return false
}
let parentBirth = birth(parent)
let args = Array(CommandLine.arguments.dropFirst())
@_silgen_name("kun_display_supported") func kunDisplaySupported() -> Int32
@_silgen_name("kun_display_run") func kunDisplayRun() -> Int32
@_silgen_name("kun_system_audio") func kunSystemAudio(_ display: UInt32, _ pid: Int32) -> Int32
@_silgen_name("kun_privacy_screen") func kunPrivacyScreen(_ display: UInt32, _ pid: Int32, _ virtual: Int32) -> Int32
if args == ["--privacy-screen-probe"] { print("kun-privacy-screen-v1"); exit(0) }
if args == ["--unlock-probe"] { print("kun-desktop-unlock-v1"); exit(0) }
if args == ["--lock-state"] {
  let payload: [String: Any] = ["lockState": currentLockState(), "inputReady": AXIsProcessTrusted()]
  if let data = try? JSONSerialization.data(withJSONObject: payload), let line = String(data: data, encoding: .utf8) {
    print(line); fflush(stdout)
  }
  exit(0)
}
if args == ["--unlock"] { runUnlockFromStdin() }
if args.count == 5 && args[0] == "--privacy-screen", let display = UInt32(args[1]), let pid = Int32(args[2]),
   ownedCapture(pid, args[3]), ["physical", "virtual"].contains(args[4]) {
  exit(kunPrivacyScreen(display, pid, args[4] == "virtual" ? 1 : 0))
}
if args.count == 4 && args[0] == "--system-audio", let selected = UInt32(args[1]), let pid = Int32(args[2]), ownedCapture(pid, args[3]) {
  exit(kunSystemAudio(selected, pid))
}
if args == ["--virtual-display-probe"] {
  if kunDisplaySupported() == 0 { exit(2) }
  print("kun-virtual-display-v1"); exit(0)
}
if args == ["--virtual-display"] { exit(kunDisplayRun()) }
if args.count == 2 && args[0] == "--identity", let pid = Int32(args[1]) {
  let identity = birth(pid)
  guard !identity.isEmpty else { exit(2) }
  print(identity); exit(0)
}
if args.count == 3 && args[0] == "--terminate", let pid = Int32(args[1]) {
  if processInfo(pid) == nil || processInfo(pid)?.pbi_status == UInt32(SZOMB) { exit(0) }
  guard ownedCapture(pid, args[2]) else { exit(2) }
  guard kill(pid, SIGKILL) == 0 || errno == ESRCH else { exit(3) }
  for _ in 0..<100 {
    if birth(pid) != args[2] || processInfo(pid)?.pbi_status == UInt32(SZOMB) { exit(0) }
    usleep(10_000)
  }
  exit(3)
}
if args == ["--release-only"] {
  guard let line = readLine(), line.utf8.count <= 8192, let data = line.data(using: .utf8),
    let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
    Set(value.keys) == Set(["keys", "buttons"]), let keys = value["keys"] as? [String],
    let buttons = value["buttons"] as? [Int], keys.count <= 64, buttons.count <= 3,
    keys.allSatisfy({ keyMap[$0] != nil }), buttons.allSatisfy({ [0,1,2].contains($0) }) else { exit(2) }
  if !keys.isEmpty || !buttons.isEmpty {
    guard AXIsProcessTrusted() else { exit(3) }
    heldKeys = Set(keys.compactMap { keyMap[$0] })
    heldButtons = Set(buttons)
    lastPoint = CGEvent(source: nil)?.location ?? .zero
    guard releaseAll() else { exit(3) }
  }
  exit(0)
}
guard args.isEmpty else { exit(2) }
func finish() -> Never {
  _ = releaseAll()
  if capturePid > 1 && !captureBirth.isEmpty && birth(capturePid) == captureBirth && processInfo(capturePid)?.pbi_uid == getuid() { kill(capturePid, SIGKILL) }
  exit(0)
}
let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
timer.schedule(deadline: .now() + .milliseconds(250), repeating: .milliseconds(250))
timer.setEventHandler {
  gate.lock(); defer { gate.unlock() }
  if parentBirth.isEmpty || birth(parent) != parentBirth || ProcessInfo.processInfo.systemUptime > deadline { finish() }
}
timer.resume()
func reply(_ id: Int, _ error: String? = nil) {
  let value: [String: Any] = error == nil ? ["id":id,"ok":true] : ["id":id,"error":error!]
  if let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data:data, encoding:.utf8) { print(line); fflush(stdout) }
}
while let line = readLine() {
  if line.utf8.count > 8192 { gate.lock(); finish() }
  guard let data=line.data(using:.utf8), let value=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any], let operation=value["operation"] as? String, let id=value["id"] as? Int else { continue }
  gate.lock()
  defer { gate.unlock() }
  if operation == "configure" {
    guard interactiveSession() else { reply(id, "DESKTOP_HOST_INACTIVE"); continue }
    guard let pid=value["capturePid"] as? Int32, pid>1, pid != parent, let expected=value["captureBirth"] as? String, ownedCapture(pid, expected), let selected=value["displayId"] as? UInt32 else { reply(id,"INVALID_REQUEST"); continue }
    capturePid=pid; captureBirth=expected; display=selected; reply(id); continue
  }
  if operation == "setupLease" {
    guard setupLeaseAllowed, let remaining = value["remainingMs"] as? Double, remaining.isFinite, remaining >= 0 else { reply(id,"INVALID_REQUEST"); continue }
    deadline = min(deadline, ProcessInfo.processInfo.systemUptime + min(15, remaining / 1000))
    reply(id); continue
  }
  if operation == "lease" {
    guard ProcessInfo.processInfo.systemUptime < deadline else { finish() }
    setupLeaseAllowed = false
    deadline=ProcessInfo.processInfo.systemUptime + min(6, max(0, (value["remainingMs"] as? Double ?? 0)/1000)); reply(id); continue
  }
  if operation == "ready" {
    reply(id, ProcessInfo.processInfo.systemUptime >= deadline ? "DESKTOP_SESSION_EXPIRED" : interactiveSession() && AXIsProcessTrusted() ? nil : "INPUT_PERMISSION_REQUIRED")
    continue
  }
  if operation == "release" { reply(id, releaseAll() ? nil : "DESKTOP_CLEANUP_UNCONFIRMED"); continue }
  if operation == "stop" {
    guard releaseAll() else { reply(id,"DESKTOP_CLEANUP_UNCONFIRMED"); continue }
    capturePid=0; reply(id); exit(0)
  }
  guard operation == "input", ProcessInfo.processInfo.systemUptime < deadline, interactiveSession(), AXIsProcessTrusted(), let event=value["event"] as? [String:Any], let type=event["type"] as? String else { reply(id,"INPUT_PERMISSION_REQUIRED"); continue }
  let bounds=CGDisplayBounds(display)
  guard CGDisplayIsOnline(display) != 0 && bounds.width >= 1 && bounds.height >= 1 else { reply(id,"DESKTOP_SOURCE_CHANGED"); continue }
  if let x=event["x"] as? Double, let y=event["y"] as? Double, x.isFinite, y.isFinite, x>=0, x<=1, y>=0, y<=1 {
    lastPoint=CGPoint(x:bounds.minX+x*(bounds.width-1),y:bounds.minY+y*(bounds.height-1))
  }
  var relativeX: Double = 0, relativeY: Double = 0
  if type == "pointer.relative" || type == "pointer.gameButton" {
    guard let current = CGEvent(source: nil)?.location, bounds.contains(current) else { reply(id,"DESKTOP_SOURCE_CHANGED"); continue }
    lastPoint = current
    if type == "pointer.relative" {
      guard let dx=event["deltaX"] as? Double, let dy=event["deltaY"] as? Double,
        dx.isFinite, dy.isFinite, abs(dx)<=1200, abs(dy)<=1200 else { reply(id,"INVALID_REQUEST"); continue }
      relativeX=dx; relativeY=dy
      lastPoint = CGPoint(x: min(bounds.maxX-1,max(bounds.minX,current.x+dx)), y: min(bounds.maxY-1,max(bounds.minY,current.y+dy)))
    }
  }
  if type == "pointer.move" || type == "pointer.drag" || type == "pointer.relative" {
    let button = heldButtons.contains(0) ? 0 : heldButtons.contains(2) ? 2 : 1
    let t: CGEventType = heldButtons.contains(0) ? .leftMouseDragged : heldButtons.contains(2) ? .rightMouseDragged : heldButtons.contains(1) ? .otherMouseDragged : .mouseMoved
    let move = CGEvent(mouseEventSource:nil,mouseType:t,mouseCursorPosition:lastPoint,mouseButton:mouseButton(button))
    if type == "pointer.relative" {
      move?.setIntegerValueField(.mouseEventDeltaX, value: Int64(relativeX.rounded()))
      move?.setIntegerValueField(.mouseEventDeltaY, value: Int64(relativeY.rounded()))
    }
    move?.flags = flags(); move?.post(tap:.cghidEventTap)
  } else if (type == "pointer.button" || type == "pointer.gameButton"), let pressed=event["pressed"] as? Bool {
    let button=(event["button"] as? Int ?? 0)
    guard [0,1,2].contains(button) else { reply(id,"INVALID_REQUEST"); continue }
    if pressed {
      heldButtons.insert(button)
      let stamp = ProcessInfo.processInfo.systemUptime
      let previous = clickPoints[button] ?? CGPoint(x: -10000, y: -10000)
      let near = abs(previous.x - lastPoint.x) < 4 && abs(previous.y - lastPoint.y) < 4
      clickCounts[button] = near && stamp - (clickTimes[button] ?? 0) < 0.5 ? min(2, (clickCounts[button] ?? 0) + 1) : 1
      clickTimes[button] = stamp; clickPoints[button] = lastPoint
    } else { heldButtons.remove(button) }
    let t: CGEventType = button == 0 ? (pressed ? .leftMouseDown : .leftMouseUp) : button == 2 ? (pressed ? .rightMouseDown : .rightMouseUp) : (pressed ? .otherMouseDown : .otherMouseUp)
    let e=CGEvent(mouseEventSource:nil,mouseType:t,mouseCursorPosition:lastPoint,mouseButton:mouseButton(button)); e?.flags=flags(); e?.setIntegerValueField(.mouseEventClickState, value: clickCounts[button] ?? 1); e?.post(tap:.cghidEventTap)
  } else if type == "pointer.wheel" {
    let dx=max(-1200,min(1200,event["deltaX"] as? Int ?? 0)); let dy=max(-1200,min(1200,event["deltaY"] as? Int ?? 0))
    let wheel = CGEvent(scrollWheelEvent2Source:nil,units:.pixel,wheelCount:2,wheel1:Int32(dy),wheel2:Int32(dx),wheel3:0)
    wheel?.location = lastPoint; wheel?.flags = flags()
    wheel?.post(tap:.cghidEventTap)
  } else if type == "key", let key=event["code"] as? String, let code=keyMap[key], let down=event["pressed"] as? Bool { postKey(code,down)
  } else if type == "text.commit", let text=event["text"] as? String, text.utf8.count<=1024 {
    let units=Array(text.utf16)
    for down in [true,false] { let e=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:down); e?.keyboardSetUnicodeString(stringLength:units.count,unicodeString:units); e?.post(tap:.cghidEventTap) }
  } else { reply(id,"INVALID_REQUEST"); continue }
  reply(id)
}
gate.lock(); finish()
