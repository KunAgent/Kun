import Foundation
import CoreGraphics
import ApplicationServices
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
let keyMap: [String: CGKeyCode] = ["KeyA":0,"KeyS":1,"KeyD":2,"KeyF":3,"KeyH":4,"KeyG":5,"KeyZ":6,"KeyX":7,"KeyC":8,"KeyV":9,"KeyB":11,"KeyQ":12,"KeyW":13,"KeyE":14,"KeyR":15,"KeyY":16,"KeyT":17,"Digit1":18,"Digit2":19,"Digit3":20,"Digit4":21,"Digit6":22,"Digit5":23,"Equal":24,"Digit9":25,"Digit7":26,"Minus":27,"Digit8":28,"Digit0":29,"BracketRight":30,"KeyO":31,"KeyU":32,"BracketLeft":33,"KeyI":34,"KeyP":35,"Enter":36,"KeyL":37,"KeyJ":38,"Quote":39,"KeyK":40,"Semicolon":41,"Backslash":42,"Comma":43,"Slash":44,"KeyN":45,"KeyM":46,"Period":47,"Tab":48,"Space":49,"Backquote":50,"Backspace":51,"Escape":53,"MetaLeft":55,"ShiftLeft":56,"AltLeft":58,"ControlLeft":59,"ArrowLeft":123,"ArrowRight":124,"ArrowDown":125,"ArrowUp":126,"Delete":117,"Home":115,"End":119,"PageUp":116,"PageDown":121]
func flags() -> CGEventFlags {
  var value = CGEventFlags()
  if heldKeys.contains(55) { value.insert(.maskCommand) }
  if heldKeys.contains(56) { value.insert(.maskShift) }
  if heldKeys.contains(58) { value.insert(.maskAlternate) }
  if heldKeys.contains(59) { value.insert(.maskControl) }
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
    var releasedFlags = flags()
    if code == 55 { releasedFlags.remove(.maskCommand) }
    if code == 56 { releasedFlags.remove(.maskShift) }
    if code == 58 { releasedFlags.remove(.maskAlternate) }
    if code == 59 { releasedFlags.remove(.maskControl) }
    event.flags = releasedFlags; event.post(tap: .cghidEventTap)
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
    reply(id, ProcessInfo.processInfo.systemUptime >= deadline ? "DESKTOP_SESSION_EXPIRED" : AXIsProcessTrusted() ? nil : "INPUT_PERMISSION_REQUIRED")
    continue
  }
  if operation == "release" { reply(id, releaseAll() ? nil : "DESKTOP_CLEANUP_UNCONFIRMED"); continue }
  if operation == "stop" {
    guard releaseAll() else { reply(id,"DESKTOP_CLEANUP_UNCONFIRMED"); continue }
    capturePid=0; reply(id); exit(0)
  }
  guard operation == "input", ProcessInfo.processInfo.systemUptime < deadline, AXIsProcessTrusted(), let event=value["event"] as? [String:Any], let type=event["type"] as? String else { reply(id,"INPUT_PERMISSION_REQUIRED"); continue }
  let bounds=CGDisplayBounds(display)
  if let x=event["x"] as? Double, let y=event["y"] as? Double, x.isFinite, y.isFinite, x>=0, x<=1, y>=0, y<=1 { lastPoint=CGPoint(x:bounds.minX+x*bounds.width,y:bounds.minY+y*bounds.height) }
  if type == "pointer.move" || type == "pointer.drag" {
    let button = heldButtons.contains(0) ? 0 : heldButtons.contains(2) ? 2 : 1
    let t: CGEventType = heldButtons.contains(0) ? .leftMouseDragged : heldButtons.contains(2) ? .rightMouseDragged : heldButtons.contains(1) ? .otherMouseDragged : .mouseMoved
    let move = CGEvent(mouseEventSource:nil,mouseType:t,mouseCursorPosition:lastPoint,mouseButton:mouseButton(button))
    move?.flags = flags(); move?.post(tap:.cghidEventTap)
  } else if type == "pointer.button", let pressed=event["pressed"] as? Bool {
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
    CGEvent(scrollWheelEvent2Source:nil,units:.pixel,wheelCount:2,wheel1:Int32(dy),wheel2:Int32(dx),wheel3:0)?.post(tap:.cghidEventTap)
  } else if type == "key", let key=event["code"] as? String, let code=keyMap[key], let down=event["pressed"] as? Bool { postKey(code,down)
  } else if type == "text.commit", let text=event["text"] as? String, text.utf8.count<=1024 {
    let units=Array(text.utf16)
    for down in [true,false] { let e=CGEvent(keyboardEventSource:nil,virtualKey:0,keyDown:down); e?.keyboardSetUnicodeString(stringLength:units.count,unicodeString:units); e?.post(tap:.cghidEventTap) }
  } else { reply(id,"INVALID_REQUEST"); continue }
  reply(id)
}
gate.lock(); finish()
