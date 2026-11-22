package main

import (
	"bufio"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

const (
	privacyShortcutID = 1
	privacyModifiers  = 0x0001 | 0x0002 | 0x0004 // Alt + Control + Shift
	privacyKey        = 0x50                     // P
)

var (
	getMessage          = user32.NewProc("GetMessageW")
	peekMessage         = user32.NewProc("PeekMessageW")
	translateMessage    = user32.NewProc("TranslateMessage")
	dispatchMessage     = user32.NewProc("DispatchMessageW")
	registerHotkey      = user32.NewProc("RegisterHotKey")
	unregisterHotkey    = user32.NewProc("UnregisterHotKey")
	setWinEventHook     = user32.NewProc("SetWinEventHook")
	unhookWinEvent      = user32.NewProc("UnhookWinEvent")
	windowEventCallback = syscall.NewCallback(func(_ uintptr, event uint32, hwnd uintptr, object, child int32, _, _ uint32) uintptr {
		if event == 3 { // EVENT_SYSTEM_FOREGROUND
			wakePrivacyThread(wmPrivacyRefresh)
		} else if hwnd != 0 && object == 0 && child == 0 { // a top-level window was shown without taking focus
			style, _, _ := windowStyle.Call(hwnd, ^uintptr(19)) // GWL_EXSTYLE
			if style&wsExTopmost != 0 {
				wakePrivacyThread(wmPrivacyRefresh)
			}
		}
		return 0
	})
)

type winMessage struct {
	Window         uintptr
	ID             uint32
	WParam, LParam uintptr
	Time           uint32
	Position       point
	Private        uint32
}

func liveOwner(handle syscall.Handle) bool {
	state, err := syscall.WaitForSingleObject(handle, 0)
	return err == nil && state == syscall.WAIT_TIMEOUT
}

func runPrivacyScreen(args []string) int {
	// The existing capture stream is already bound to this approved screen by
	// Electron. The helper only owns local windows, never another capture source.
	if len(args) != 5 || args[4] != "physical" || !privacyAvailable() {
		return 2
	}
	if _, err := strconv.ParseInt(args[1], 10, 64); err != nil {
		return 2
	}
	pid, err := strconv.ParseUint(args[2], 10, 32)
	if err != nil || pid <= 1 {
		return 2
	}
	parent, err := syscall.OpenProcess(synchronize, false, uint32(os.Getppid()))
	if err != nil {
		return 2
	}
	defer syscall.CloseHandle(parent)
	renderer, err := ownedCaptureHandle(int(pid), args[3], 0)
	if err != nil {
		return 2
	}
	defer syscall.CloseHandle(renderer)
	return servePrivacyScreen(parent, renderer, monitorBounds)
}

func servePrivacyScreen(parent, renderer syscall.Handle, bounds func() ([]rectangle, error)) int {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	done := make(chan struct{})
	defer close(done)
	if !defaultDesktop() || !liveOwner(parent) || !liveOwner(renderer) {
		return 2
	}
	// Use physical monitor coordinates even when monitors have different DPI.
	dpi := user32.NewProc("SetThreadDpiAwarenessContext")
	old, _, _ := dpi.Call(^uintptr(3))
	if old == 0 {
		return 2
	}
	defer dpi.Call(old)
	curtains, err := newPrivacyCurtains()
	if err != nil {
		return 2
	}
	defer curtains.close()
	if ok, _, _ := registerHotkey.Call(0, privacyShortcutID, privacyModifiers|0x4000, privacyKey); ok == 0 { // MOD_NOREPEAT
		return 4
	}
	defer unregisterHotkey.Call(0, privacyShortcutID)

	var message winMessage
	peekMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0, 0) // create the thread's message queue
	uiThread, _, _ := threadID.Call()
	// Keep curtains above other normal-desktop topmost windows, including
	// non-activating popups. These are out-of-process visibility notifications.
	for _, event := range []uintptr{3, 0x8002} { // EVENT_SYSTEM_FOREGROUND, EVENT_OBJECT_SHOW
		hook, _, _ := setWinEventHook.Call(event, event, 0, windowEventCallback, 0, 0, 2) // WINEVENT_SKIPOWNPROCESS
		if hook == 0 {
			return 2
		}
		defer unhookWinEvent.Call(hook)
	}

	start := time.Now()
	var expires atomic.Int64
	expires.Store(int64(maxPrivacyLease))
	go func() {
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if time.Since(start) >= time.Duration(expires.Load()) || !liveOwner(parent) || !liveOwner(renderer) || !defaultDesktop() {
					// Windows destroys every HWND when the owner exits, even if its UI thread is stuck.
					os.Exit(3)
				}
			}
		}
	}()

	visible := false
	refresh := func() bool {
		areas, err := bounds()
		return err == nil && len(areas) > 0 && curtains.sync(areas, visible) == nil
	}
	if !refresh() {
		return 3
	}
	requests := make(chan privacyRequest, 8)
	timer, _, _ := user32.NewProc("SetTimer").Call(0, 0, 400, 0)
	if timer == 0 {
		return 2
	}
	defer user32.NewProc("KillTimer").Call(0, timer)
	go readPrivacyCommands(uiThread, start, requests, done)
	if _, err := fmt.Fprintln(os.Stdout, "ready 0 0"); err != nil {
		return 3
	}
	for {
		got, _, _ := getMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if int32(got) <= 0 || time.Since(start) >= time.Duration(expires.Load()) {
			return 3
		}
		switch message.ID {
		case wmHotkey:
			if message.Window == 0 && message.WParam == privacyShortcutID && message.LParam>>16 == privacyKey {
				return 5
			}
		case 0x0113: // WM_TIMER
			if message.WParam == timer && visible {
				areas, err := bounds()
				if err != nil || len(areas) == 0 {
					return 3
				}
				if !curtains.hasBounds(areas) {
					if curtains.sync(areas, true) != nil {
						return 3
					}
				} else if !curtains.covered() {
					return 3
				}
			}
		case wmPrivacyEnd:
			return 5
		case wmPrivacyRefresh:
			if visible && !refresh() {
				return 3
			}
		case wmPrivacyCommand:
			// A window message only wakes the loop. The inherited stdin pipe is
			// the sole source of show requests and lease renewals.
			select {
			case request := <-requests:
				if !request.show {
					if time.Since(start) >= request.expires {
						return 3
					}
					expires.Store(int64(request.expires))
					continue
				}
				visible = true
				if !liveOwner(parent) || !liveOwner(renderer) || !defaultDesktop() || !refresh() {
					return 3
				}
				if _, err := fmt.Fprintln(os.Stdout, "shown"); err != nil {
					return 3
				}
			default:
			}
		default:
			translateMessage.Call(uintptr(unsafe.Pointer(&message)))
			dispatchMessage.Call(uintptr(unsafe.Pointer(&message)))
		}
	}
}

func readPrivacyCommands(thread uintptr, start time.Time, requests chan<- privacyRequest, done <-chan struct{}) {
	lines := bufio.NewScanner(os.Stdin)
	lines.Buffer(make([]byte, 64), 64)
	for lines.Scan() {
		request, ok := parsePrivacyRequest(lines.Text(), time.Since(start))
		if !ok {
			break
		}
		select {
		case requests <- request:
		case <-done:
			return
		}
		if posted, _, _ := postThreadMessage.Call(thread, wmPrivacyCommand, 0, 0); posted == 0 {
			break
		}
	}
	// EOF or a malformed command must restore the desktop without waiting for
	// Windows to deliver another window message.
	os.Exit(3)
}
