import Foundation
import CoreGraphics
import CoreAudio

// Physical codes stay in this process solely to match releases to paws.
// No characters, key names, codes, app names or audio leave this helper.
let arguments = Set(CommandLine.arguments.dropFirst())
let wantsKeyboard = arguments.contains("--keyboard")
let wantsMicrophone = arguments.contains("--microphone")
let probe = arguments.contains("--status")
let parent = getppid()
var lastHeartbeat = ProcessInfo.processInfo.systemUptime
var eventTap: CFMachPort?
var eventSource: CFRunLoopSource?
var mouseTap: CFMachPort?
var mouseSource: CFRunLoopSource?
var keyboardState = "off"
var microphoneState = "off"
var lastStatus = ""

func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}

func status() {
    let key = keyboardState + ":" + microphoneState
    if key == lastStatus { return }
    lastStatus = key
    emit(["type": "status", "keyboard": keyboardState, "microphone": microphoneState])
}

// ANSI physical positions. The result is only left/right/both and a coarse 6x3 grid, never a character.
func pawMask(_ key: CGKeyCode) -> Int {
    if key == 49 { return 3 } // Space: both paws.
    let left: Set<CGKeyCode> = [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 23, 48, 50, 53]
    if left.contains(key) { return 1 }
    let right: Set<CGKeyCode> = [4, 16, 22, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
        40, 41, 42, 43, 44, 45, 46, 47, 51, 65, 67, 69, 71, 75, 76, 78, 81, 82, 83, 84, 85, 86, 87,
        88, 89, 91, 92, 93, 94, 95, 102, 114, 115, 116, 117, 119, 121, 123, 124, 125, 126]
    return right.contains(key) ? 2 : 0
}

func keyZone(_ key: CGKeyCode) -> [String: Int]? {
    if key == 49 { return ["col": 2, "row": 2] }
    switch key {
    case 53, 50, 18, 19, 12: return ["col": 0, "row": 0]
    case 48, 0: return ["col": 0, "row": 1]
    case 6, 10: return ["col": 0, "row": 2]
    case 20, 13, 14: return ["col": 1, "row": 0]
    case 1, 2: return ["col": 1, "row": 1]
    case 7, 8: return ["col": 1, "row": 2]
    case 21, 23, 15, 17: return ["col": 2, "row": 0]
    case 3, 5: return ["col": 2, "row": 1]
    case 9, 11: return ["col": 2, "row": 2]
    case 22, 26, 16, 32: return ["col": 3, "row": 0]
    case 4, 38: return ["col": 3, "row": 1]
    case 45, 46: return ["col": 3, "row": 2]
    case 28, 25, 34, 31: return ["col": 4, "row": 0]
    case 40, 37: return ["col": 4, "row": 1]
    case 43, 47, 123: return ["col": 4, "row": 2]
    case 29, 27, 24, 35, 33, 30, 51, 71, 75, 67, 78, 89, 91, 92, 93, 114, 115, 116, 117: return ["col": 5, "row": 0]
    case 41, 39, 42, 36, 69, 86, 87, 88, 119, 121, 126: return ["col": 5, "row": 1]
    default: return pawMask(key) == 2 ? ["col": 5, "row": 2] : nil
    }
}

final class KeyboardActivity {
    private var pressed: [CGKeyCode: Int] = [:]
    private var sequence = 0
    var includeZones = true
    var held: Int { pressed.values.reduce(0) { $0 | $1 } }

    func down(_ key: CGKeyCode, repeated: Bool) {
        let mask = pawMask(key)
        guard mask != 0, pressed[key] == nil else { return }
        if pressed.count >= 128 { reset() }
        pressed[key] = mask
        publish(tap: repeated ? 0 : mask, zone: repeated ? nil : keyZone(key))
    }
    func up(_ key: CGKeyCode) {
        guard pressed.removeValue(forKey: key) != nil else { return }
        publish(tap: 0, zone: nil)
    }
    func reset() {
        guard !pressed.isEmpty else { return }
        pressed.removeAll()
        publish(tap: 0, zone: nil)
    }
    func reconcile() {
        // Check only keys already observed, to recover a missed release.
        let missing = pressed.keys.filter { !CGEventSource.keyState(.combinedSessionState, key: $0) }
        for key in missing { pressed.removeValue(forKey: key) }
        if !missing.isEmpty || held != 0 { publish(tap: 0, zone: nil) }
    }
    func publish(tap: Int, zone: [String: Int]?) {
        sequence += 1
        var payload: [String: Any] = ["type": "keys", "sequence": sequence, "held": held, "tap": tap]
        if includeZones, let zone { payload["zone"] = zone }
        emit(payload)
    }
}
let keyboard = KeyboardActivity()

final class MouseActivity {
    private(set) var buttons = 0
    private var sequence = 0
    private var lastWheelAt: TimeInterval = 0

    func button(_ mask: Int, down: Bool) {
        let next = down ? (buttons | mask) : (buttons & ~mask)
        guard next != buttons else { return }
        buttons = next
        publish(wheel: 0)
    }
    func wheel(_ delta: Int64) {
        guard delta != 0 else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastWheelAt >= 0.06 else { return }
        lastWheelAt = now
        publish(wheel: delta > 0 ? -1 : 1)
    }
    func reset() {
        guard buttons != 0 else { return }
        buttons = 0
        publish(wheel: 0)
    }
    func reconcile() {
        guard buttons != 0 else { return }
        var actual = 0
        if CGEventSource.buttonState(.combinedSessionState, button: .left) { actual |= 1 }
        if CGEventSource.buttonState(.combinedSessionState, button: .right) { actual |= 2 }
        if CGEventSource.buttonState(.combinedSessionState, button: .center) { actual |= 4 }
        if actual != buttons {
            buttons = actual
            publish(wheel: 0)
        }
    }
    private func publish(wheel: Int) {
        sequence += 1
        emit(["type": "mouse", "sequence": sequence, "buttons": buttons, "wheel": wheel])
    }
}
let mouse = MouseActivity()

func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
                               mElement: kAudioObjectPropertyElementMain)
}

@available(macOS 14.2, *)
func microphoneRunning() -> Bool? {
    var listAddress = address(kAudioHardwarePropertyProcessObjectList)
    var size: UInt32 = 0
    let system = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(system, &listAddress, 0, nil, &size) == noErr,
          size <= 1024 * 1024 else { return nil }
    if size == 0 { return false }
    var processes = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    let result = processes.withUnsafeMutableBytes { bytes in
        AudioObjectGetPropertyData(system, &listAddress, 0, nil, &size, bytes.baseAddress!)
    }
    guard result == noErr else { return nil }
    for process in processes.prefix(Int(size) / MemoryLayout<AudioObjectID>.size) {
        var property = address(kAudioProcessPropertyIsRunningInput)
        var running: UInt32 = 0
        var propertySize = UInt32(MemoryLayout<UInt32>.size)
        // A process may exit between enumeration and this read.
        if AudioObjectGetPropertyData(process, &property, 0, nil, &propertySize, &running) == noErr && running != 0 {
            return true
        }
    }
    return false
}

func stopMouse() {
    mouse.reset()
    if let tap = mouseTap { CGEvent.tapEnable(tap: tap, enable: false); CFMachPortInvalidate(tap) }
    if let source = mouseSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
    mouseTap = nil
    mouseSource = nil
}

func stopKeyboard() {
    keyboard.reset()
    stopMouse()
    if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: false); CFMachPortInvalidate(tap) }
    if let source = eventSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
    eventTap = nil
    eventSource = nil
}

func syncMouse() {
    guard wantsKeyboard, !probe else { return }
    if mouseTap != nil { return }
    let mouseEvents: CGEventMask =
        (CGEventMask(1) << CGEventType.leftMouseDown.rawValue) |
        (CGEventMask(1) << CGEventType.leftMouseUp.rawValue) |
        (CGEventMask(1) << CGEventType.rightMouseDown.rawValue) |
        (CGEventMask(1) << CGEventType.rightMouseUp.rawValue) |
        (CGEventMask(1) << CGEventType.otherMouseDown.rawValue) |
        (CGEventMask(1) << CGEventType.otherMouseUp.rawValue) |
        (CGEventMask(1) << CGEventType.scrollWheel.rawValue)
    mouseTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
        eventsOfInterest: mouseEvents,
        callback: { _, type, event, _ in
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                mouse.reset()
                if let tap = mouseTap { CGEvent.tapEnable(tap: tap, enable: true) }
            } else if type == .leftMouseDown {
                mouse.button(1, down: true)
            } else if type == .leftMouseUp {
                mouse.button(1, down: false)
            } else if type == .rightMouseDown {
                mouse.button(2, down: true)
            } else if type == .rightMouseUp {
                mouse.button(2, down: false)
            } else if type == .otherMouseDown {
                mouse.button(4, down: true)
            } else if type == .otherMouseUp {
                mouse.button(4, down: false)
            } else if type == .scrollWheel {
                let dy = event.getIntegerValueField(.scrollWheelEventPointDeltaAxis1)
                let fallback = event.getIntegerValueField(.scrollWheelEventDeltaAxis1)
                mouse.wheel(dy != 0 ? dy : fallback)
            }
            return Unmanaged.passUnretained(event)
        }, userInfo: nil)
    guard let tap = mouseTap else { return }
    mouseSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), mouseSource, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
}

func syncKeyboard() {
    guard wantsKeyboard else { return }
    syncMouse()
    guard CGPreflightListenEventAccess() else {
        keyboard.reset()
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: false); CFMachPortInvalidate(tap) }
        if let source = eventSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        eventTap = nil
        eventSource = nil
        keyboardState = "permission-required"
        return
    }
    if probe { keyboardState = "active"; return }
    if eventTap != nil { return }
    // Keep keyboard tap strictly key-only so mouse permissions never mask missing Input Monitoring.
    let eventsOfInterest: CGEventMask =
        (CGEventMask(1) << CGEventType.keyDown.rawValue) |
        (CGEventMask(1) << CGEventType.keyUp.rawValue)
    eventTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
        eventsOfInterest: eventsOfInterest,
        callback: { _, type, event, _ in
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                keyboard.reset()
                if let tap = eventTap, CGPreflightListenEventAccess() { CGEvent.tapEnable(tap: tap, enable: true) }
            } else if type == .keyDown || type == .keyUp {
                let key = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
                if type == .keyDown {
                    keyboard.down(key, repeated: event.getIntegerValueField(.keyboardEventAutorepeat) != 0)
                } else { keyboard.up(key) }
            }
            return Unmanaged.passUnretained(event)
        }, userInfo: nil)
    guard let tap = eventTap else { keyboardState = "unavailable"; return }
    eventSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), eventSource, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    keyboardState = "active"
}

func poll() {
    syncKeyboard()
    if !probe {
        if keyboardState == "active" { keyboard.reconcile() }
        if mouseTap != nil { mouse.reconcile() }
    }
    if wantsMicrophone {
        if #available(macOS 14.2, *) {
            if let running = microphoneRunning() {
                microphoneState = "active"
                if !probe { emit(["type": "recording", "active": running]) }
            } else {
                microphoneState = "unavailable"
                if !probe { emit(["type": "recording", "active": false]) }
            }
        } else { microphoneState = "unsupported" }
    }
    status()
}

if arguments.contains("--self-test") {
    // No observers or permission requests in this mode.
    keyboard.includeZones = false
    emit(["type": "status", "keyboard": "off", "microphone": "off"])
    keyboard.down(0, repeated: false)
    keyboard.down(0, repeated: true)
    keyboard.down(1, repeated: false)
    keyboard.down(38, repeated: false)
    keyboard.up(0)
    keyboard.up(1)
    keyboard.up(38)
    keyboard.down(49, repeated: false)
    keyboard.reset()
    emit(["type": "recording", "active": true])
    emit(["type": "recording", "active": false])
    exit(0)
}
if arguments.contains("--self-test-desk") {
    keyboard.down(0, repeated: false)
    keyboard.up(0)
    mouse.button(1, down: true)
    mouse.button(1, down: false)
    mouse.wheel(-12)
    exit(0)
}
if arguments.contains("--request-keyboard") { _ = CGRequestListenEventAccess() }
poll()
if probe { exit(0) }

// The owner keeps the observer alive; EOF or a missing heartbeat removes the tap.
FileHandle.standardInput.readabilityHandler = { handle in
    let data = handle.availableData
    DispatchQueue.main.async {
        if data.isEmpty { stopKeyboard(); exit(0) }
        lastHeartbeat = ProcessInfo.processInfo.systemUptime
    }
}
let timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
    if getppid() != parent || ProcessInfo.processInfo.systemUptime - lastHeartbeat > 15 {
        stopKeyboard()
        exit(0)
    }
    poll()
}
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.run()
