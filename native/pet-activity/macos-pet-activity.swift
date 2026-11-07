import Foundation
import CoreGraphics
import CoreAudio

// State only: no key codes, characters, process names, audio buffers or recording APIs.
let arguments = Set(CommandLine.arguments.dropFirst())
let wantsKeyboard = arguments.contains("--keyboard")
let wantsMicrophone = arguments.contains("--microphone")
let probe = arguments.contains("--status")
let parent = getppid()
var lastHeartbeat = ProcessInfo.processInfo.systemUptime
var lastTyping = -Double.infinity
var eventTap: CFMachPort?
var eventSource: CFRunLoopSource?
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

func stopKeyboard() {
    if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: false); CFMachPortInvalidate(tap) }
    if let source = eventSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
    eventTap = nil
    eventSource = nil
}

func syncKeyboard() {
    guard wantsKeyboard else { return }
    guard CGPreflightListenEventAccess() else {
        stopKeyboard()
        keyboardState = "permission-required"
        return
    }
    if probe { keyboardState = "active"; return }
    if eventTap != nil { return }
    eventTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
        eventsOfInterest: CGEventMask(1) << CGEventType.keyDown.rawValue,
        callback: { _, type, event, _ in
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                if let tap = eventTap, CGPreflightListenEventAccess() { CGEvent.tapEnable(tap: tap, enable: true) }
            } else if type == .keyDown && !event.flags.contains(.maskCommand) && !event.flags.contains(.maskControl) {
                let now = ProcessInfo.processInfo.systemUptime
                if now - lastTyping >= 0.2 { lastTyping = now; emit(["type": "typing"]) }
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
    emit(["type": "status", "keyboard": "off", "microphone": "off"])
    emit(["type": "typing"])
    emit(["type": "recording", "active": true])
    emit(["type": "recording", "active": false])
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
