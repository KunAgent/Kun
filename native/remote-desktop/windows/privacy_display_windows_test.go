package main

import (
	"os"
	"runtime"
	"strconv"
	"syscall"
	"testing"
	"unsafe"
)

var getLayer = user32.NewProc("GetLayeredWindowAttributes")
var classBrush = user32.NewProc("GetClassLongPtrW")
var isWindow = user32.NewProc("IsWindow")

func opaqueCurtain(hwnd uintptr) bool {
	var alpha byte
	var flags uint32
	got, _, _ := getLayer.Call(hwnd, 0, uintptr(unsafe.Pointer(&alpha)), uintptr(unsafe.Pointer(&flags)))
	visible, _, _ := isWindowVisible.Call(hwnd)
	style, _, _ := windowStyle.Call(hwnd, ^uintptr(19)) // GWL_EXSTYLE = -20
	const required = wsExTopmost | wsExLayered | wsExTransparent | wsExNoActivate
	return got != 0 && alpha == 255 && flags&layerAlpha != 0 && visible != 0 && style&required == required && excludedCurtain(hwnd)
}

func TestPrivacyCurtainsFollowMonitorBounds(t *testing.T) {
	if !privacyAvailable() || !defaultDesktop() {
		t.Skip("requires an unlocked Windows 10 2004+ graphical desktop")
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	dpi := user32.NewProc("SetThreadDpiAwarenessContext")
	old, _, _ := dpi.Call(^uintptr(3))
	if old == 0 {
		t.Fatal("per-monitor DPI awareness unavailable")
	}
	defer dpi.Call(old)

	monitors, err := monitorBounds()
	if err != nil {
		t.Fatal(err)
	}
	origin := monitors[0]
	// Only two small test rectangles are covered, even on a multi-monitor workstation.
	a := rectangle{origin.Left + 4, origin.Top + 8, origin.Left + 36, origin.Top + 40}
	b := rectangle{a.Right + 4, a.Top, a.Right + 36, a.Bottom}
	c, err := newPrivacyCurtains()
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	if err := c.sync([]rectangle{a, b}, false); err != nil {
		t.Fatal(err)
	}
	first, second := c.windows[a], c.windows[b]
	if !excludedCurtain(first) || !excludedCurtain(second) || opaqueCurtain(first) {
		t.Fatal("prepare must arm exclusion before going black")
	}
	if err := c.sync([]rectangle{a, b}, true); err != nil {
		t.Fatal(err)
	}
	black, _, _ := stockObject.Call(4)
	for _, hwnd := range []uintptr{first, second} {
		brush, _, _ := classBrush.Call(hwnd, ^uintptr(9)) // GCLP_HBRBACKGROUND = -10
		if !opaqueCurtain(hwnd) || brush != black {
			t.Fatal("missing opaque, click-through black curtain")
		}
	}
	if err := c.sync([]rectangle{b}, true); err != nil {
		t.Fatal(err)
	}
	if exists, _, _ := isWindow.Call(first); exists != 0 || !opaqueCurtain(second) {
		t.Fatal("monitor removal did not retire just the missing curtain")
	}
}

// The Electron smoke runs this in an independent process. Check the native
// composition state above its known source window; screen capture deliberately
// omits the privacy windows, so capturing a screenshot cannot prove local black.
func TestObservePhonePrivacy(t *testing.T) {
	id := os.Getenv("KUN_TEST_PRIVACY_HWND")
	if id == "" {
		t.Skip("used by the Windows WebRTC fixture")
	}
	source, err := strconv.ParseUint(id, 16, 64)
	if err != nil || source == 0 {
		t.Fatal("invalid source window")
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	dpi := user32.NewProc("SetThreadDpiAwarenessContext")
	old, _, _ := dpi.Call(^uintptr(3))
	if old == 0 {
		t.Fatal("missing DPI context")
	}
	defer dpi.Call(old)
	var rect rectangle
	if ok, _, _ := getWindowRect.Call(uintptr(source), uintptr(unsafe.Pointer(&rect))); ok == 0 {
		t.Fatal("source window unavailable")
	}
	monitors, err := monitorBounds()
	if err != nil || len(monitors) != 1 || monitors[0] != rect {
		t.Fatal("source must cover the entire disposable monitor")
	}
	active := os.Getenv("KUN_TEST_PRIVACY_OPAQUE") == "1"
	top, _, _ := user32.NewProc("GetTopWindow").Call(0)
	next := user32.NewProc("GetWindow")
	name := user32.NewProc("GetClassNameW")
	covered, present, found := false, false, false
	for hwnd := top; hwnd != 0; {
		if hwnd == uintptr(source) {
			found = true
		}
		var class [64]uint16
		name.Call(hwnd, uintptr(unsafe.Pointer(&class[0])), uintptr(len(class)))
		if syscall.UTF16ToString(class[:]) == "KunRemotePrivacyCurtain" {
			present = true
			var area rectangle
			ok, _, _ := getWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&area)))
			if !found && ok != 0 && area == rect && opaqueCurtain(hwnd) {
				covered = true
			}
		}
		hwnd, _, _ = next.Call(hwnd, 2) // GW_HWNDNEXT: top to bottom, without changing focus.
	}
	if !found || covered != active || present != active {
		t.Fatalf("source present=%t, opaque excluded curtain above source=%t, want %t", found, covered, active)
	}
	x, y := rect.Left+(rect.Right-rect.Left)/2, rect.Top+(rect.Bottom-rect.Top)/2
	packed := uint64(uint32(x)) | uint64(uint32(y))<<32
	hit, _, _ := user32.NewProc("WindowFromPoint").Call(uintptr(packed))
	ancestor, _, _ := user32.NewProc("GetAncestor").Call(hit, 2) // GA_ROOT
	if ancestor != uintptr(source) {
		t.Fatal("test input would not reach the source window")
	}
}
