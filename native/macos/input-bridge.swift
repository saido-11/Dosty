import ApplicationServices
import Foundation

setbuf(stdout, nil)

func hasInputPermission() -> Bool {
    return CGPreflightListenEventAccess() || AXIsProcessTrusted()
}

let args = CommandLine.arguments
if args.contains("--check-permission") {
    print(hasInputPermission() ? "P:1" : "P:0")
    exit(0)
}

if args.contains("--request-permission") {
    let granted = CGRequestListenEventAccess() || AXIsProcessTrusted()
    print(granted ? "P:1" : "P:0")
    exit(0)
}

// Only momentary physical key-down boolean state is kept in memory (0..255).
// No key codes, characters, or text are ever decoded, logged, saved, or emitted.
final class InputState {
    var down = [Bool](repeating: false, count: 256)
    var mouseTap: CFMachPort?
    var keyTap: CFMachPort?
    var keyRunLoopSource: CFRunLoopSource?
    var lastPermitted: Bool = false
    var leftPressed = false
    var rightPressed = false

    func resetModifiers() {
        for idx in 54...63 {
            down[idx] = false
        }
    }
}

let state = InputState()

let mouseMask: CGEventMask =
    (1 << CGEventType.leftMouseDown.rawValue) |
    (1 << CGEventType.leftMouseUp.rawValue) |
    (1 << CGEventType.rightMouseDown.rawValue)

let keyMask: CGEventMask =
    (1 << CGEventType.keyDown.rawValue) |
    (1 << CGEventType.keyUp.rawValue) |
    (1 << CGEventType.flagsChanged.rawValue)

let mouseCallback: CGEventTapCallBack = { _, type, event, userInfo in
    guard let userInfo = userInfo else { return Unmanaged.passUnretained(event) }
    let st = Unmanaged<InputState>.fromOpaque(userInfo).takeUnretainedValue()

    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = st.mouseTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }

    // Mouse state polling supplies events when the event tap is unavailable.
    if !st.lastPermitted { return Unmanaged.passUnretained(event) }
    if type == .leftMouseDown { print("L:1") }
    if type == .leftMouseUp { print("L:0") }
    if type == .leftMouseDown || type == .rightMouseDown {
        print("M")
    }
    return Unmanaged.passUnretained(event)
}

let keyCallback: CGEventTapCallBack = { _, type, event, userInfo in
    guard let userInfo = userInfo else { return Unmanaged.passUnretained(event) }
    let st = Unmanaged<InputState>.fromOpaque(userInfo).takeUnretainedValue()

    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = st.keyTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }

    let code = Int(event.getIntegerValueField(.keyboardEventKeycode))
    guard code >= 0 && code < 256 else {
        return Unmanaged.passUnretained(event)
    }

    switch type {
    case .keyDown:
        let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
        if !isRepeat && !st.down[code] {
            st.down[code] = true
            print("K")
        }
    case .keyUp:
        st.down[code] = false
    case .flagsChanged:
        if code == 57 {
            // Caps Lock: emit strike when engaged
            if event.flags.contains(.maskAlphaShift) && !st.down[code] {
                st.down[code] = true
                print("K")
            } else if !event.flags.contains(.maskAlphaShift) {
                st.down[code] = false
            }
        } else if (54...63).contains(code) {
            let activeModifiers: CGEventFlags = [
                .maskShift, .maskControl, .maskAlternate, .maskCommand, .maskSecondaryFn
            ]
            if event.flags.intersection(activeModifiers).isEmpty {
                st.resetModifiers()
            } else if !st.down[code] {
                st.down[code] = true
                print("K")
            } else {
                st.down[code] = false
            }
        }
    default:
        break
    }

    return Unmanaged.passUnretained(event)
}

func installMouseTap(_ st: InputState) {
    let ptr = Unmanaged.passUnretained(st).toOpaque()
    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: mouseMask,
        callback: mouseCallback,
        userInfo: ptr
    ) else { return }

    st.mouseTap = tap
    if let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) {
        CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
    }
    CGEvent.tapEnable(tap: tap, enable: true)
}

func installOrRefreshKeyTap(_ st: InputState) {
    if let oldSrc = st.keyRunLoopSource {
        CFRunLoopRemoveSource(CFRunLoopGetMain(), oldSrc, .commonModes)
        st.keyRunLoopSource = nil
    }
    if let oldTap = st.keyTap {
        CFMachPortInvalidate(oldTap)
        st.keyTap = nil
    }

    let ptr = Unmanaged.passUnretained(st).toOpaque()
    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: keyMask,
        callback: keyCallback,
        userInfo: ptr
    ) else { return }

    st.keyTap = tap
    if let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) {
        st.keyRunLoopSource = src
        CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
    }
    CGEvent.tapEnable(tap: tap, enable: true)
}

state.lastPermitted = hasInputPermission()
print(state.lastPermitted ? "P:1" : "P:0")

installMouseTap(state)
installOrRefreshKeyTap(state)

// Public mouse-button state remains available without global keyboard permission.
// Keep sampling even with a tap so permission transitions cannot leave a held drag stuck.
Timer.scheduledTimer(withTimeInterval: 0.008, repeats: true) { _ in
    let left = CGEventSource.buttonState(.combinedSessionState, button: .left)
    let right = CGEventSource.buttonState(.combinedSessionState, button: .right)
    if state.mouseTap == nil || !state.lastPermitted {
        if left != state.leftPressed {
            print(left ? "L:1" : "L:0")
            if left { print("M") }
        }
        if right && !state.rightPressed { print("M") }
    }
    state.leftPressed = left
    state.rightPressed = right
}

// Exit automatically if parent Electron process closes stdin or terminates.
let stdinSource = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .global())
stdinSource.setEventHandler {
    var buffer = [UInt8](repeating: 0, count: 64)
    let bytesRead = read(STDIN_FILENO, &buffer, buffer.count)
    if bytesRead <= 0 {
        exit(0)
    }
}
stdinSource.resume()

// Poll permission changes gently so granting Input Monitoring works smoothly.
Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { _ in
    let current = hasInputPermission()
    if current != state.lastPermitted {
        state.lastPermitted = current
        print(current ? "P:1" : "P:0")
        if current {
            installOrRefreshKeyTap(state)
        }
    }
}

CFRunLoopRun()
