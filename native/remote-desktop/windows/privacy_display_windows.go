package main

import (
	"errors"
	"path/filepath"
	"syscall"
	"unsafe"
)

const (
	excludeFromCapture = 0x11 // WDA_EXCLUDEFROMCAPTURE, Windows 10 build 19041+
	wsPopup            = 0x80000000
	wsExTopmost        = 0x00000008
	wsExTransparent    = 0x00000020
	wsExToolWindow     = 0x00000080
	wsExLayered        = 0x00080000
	wsExNoActivate     = 0x08000000
	layerAlpha         = 2 // LWA_ALPHA
	swpNoActivate      = 0x0010
	swpShowWindow      = 0x0040

	wmHotkey         = 0x0312
	wmPrivacyCommand = 0x8001
	wmPrivacyRefresh = 0x8002
	wmPrivacyEnd     = 0x8003
)

var (
	kernel32              = syscall.NewLazyDLL("kernel32.dll")
	stockObject           = syscall.NewLazyDLL("gdi32.dll").NewProc("GetStockObject")
	moduleHandle          = kernel32.NewProc("GetModuleHandleW")
	threadID              = kernel32.NewProc("GetCurrentThreadId")
	registerWindowClass   = user32.NewProc("RegisterClassExW")
	unregisterWindowClass = user32.NewProc("UnregisterClassW")
	createWindow          = user32.NewProc("CreateWindowExW")
	destroyWindow         = user32.NewProc("DestroyWindow")
	defWindowProc         = user32.NewProc("DefWindowProcW")
	setWindowPos          = user32.NewProc("SetWindowPos")
	getWindowRect         = user32.NewProc("GetWindowRect")
	windowStyle           = user32.NewProc("GetWindowLongPtrW")
	isWindowVisible       = user32.NewProc("IsWindowVisible")
	setLayer              = user32.NewProc("SetLayeredWindowAttributes")
	setAffinity           = user32.NewProc("SetWindowDisplayAffinity")
	getAffinity           = user32.NewProc("GetWindowDisplayAffinity")
	redrawWindow          = user32.NewProc("RedrawWindow")
	enumDisplayMonitors   = user32.NewProc("EnumDisplayMonitors")
	postThreadMessage     = user32.NewProc("PostThreadMessageW")
	curtainClassName      = syscall.StringToUTF16Ptr("KunRemotePrivacyCurtain")
	curtainProc           = syscall.NewCallback(privacyWindowProc)
	collectMonitor        = syscall.NewCallback(appendMonitorBounds)
)

type windowClass struct {
	Size, Style                        uint32
	Proc                               uintptr
	ClassExtra, WindowExtra            int32
	Instance, Icon, Cursor, Background uintptr
	MenuName, ClassName                *uint16
	SmallIcon                          uintptr
}

type osVersion struct {
	Size, Major, Minor, Build, Platform uint32
	ServicePack                         [128]uint16
}

// Earlier builds silently treat 0x11 as WDA_MONITOR, which records a black rectangle.
func privacyAvailable() bool {
	var version osVersion
	version.Size = uint32(unsafe.Sizeof(version))
	result, _, _ := syscall.NewLazyDLL("ntdll.dll").NewProc("RtlGetVersion").Call(uintptr(unsafe.Pointer(&version)))
	return int32(result) == 0 && (version.Major > 10 || version.Major == 10 && version.Build >= 19041) &&
		setAffinity.Find() == nil && getAffinity.Find() == nil
}

func compositorLibrary() (*syscall.LazyDLL, error) {
	var system [syscall.MAX_PATH]uint16
	n, _, _ := kernel32.NewProc("GetSystemDirectoryW").Call(uintptr(unsafe.Pointer(&system[0])), uintptr(len(system)))
	if n == 0 || n >= uintptr(len(system)) {
		return nil, errors.New("no system directory")
	}
	dwm := syscall.NewLazyDLL(filepath.Join(syscall.UTF16ToString(system[:]), "dwmapi.dll"))
	return dwm, dwm.Load()
}

func wakePrivacyThread(msg uintptr) {
	id, _, _ := threadID.Call()
	postThreadMessage.Call(id, msg, 0, 0)
}

func privacyWindowProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	switch msg {
	case 0x0010: // WM_CLOSE
		wakePrivacyThread(wmPrivacyEnd)
		return 0
	case 0x007e, 0x0219, 0x02e0, 0x031e: // display, device, DPI or compositor change
		wakePrivacyThread(wmPrivacyRefresh)
		return 0
	case 0x0021: // WM_MOUSEACTIVATE
		return 3 // MA_NOACTIVATE
	case 0x0084: // WM_NCHITTEST; the layered transparent style also passes clicks across processes.
		return ^uintptr(0) // HTTRANSPARENT
	}
	result, _, _ := defWindowProc.Call(hwnd, uintptr(msg), wParam, lParam)
	return result
}

func appendMonitorBounds(_, _ uintptr, area *rectangle, out *[]rectangle) uintptr {
	if area == nil || area.Right <= area.Left || area.Bottom <= area.Top {
		return 0
	}
	for _, existing := range *out {
		if existing == *area {
			return 1
		} // cloned displays share one desktop rectangle
	}
	*out = append(*out, *area)
	return 1
}

func monitorBounds() ([]rectangle, error) {
	var result []rectangle
	ok, _, err := enumDisplayMonitors.Call(0, 0, collectMonitor, uintptr(unsafe.Pointer(&result)))
	if ok == 0 || len(result) == 0 {
		return nil, err
	}
	return result, nil
}

type privacyCurtains struct {
	attribute *syscall.LazyProc
	instance  uintptr
	flush     *syscall.LazyProc
	windows   map[rectangle]uintptr
}

func newPrivacyCurtains() (*privacyCurtains, error) {
	dwm, err := compositorLibrary()
	if err != nil {
		return nil, err
	}
	flush := dwm.NewProc("DwmFlush")
	attribute := dwm.NewProc("DwmGetWindowAttribute")
	if err := flush.Find(); err != nil {
		return nil, err
	}
	if err := attribute.Find(); err != nil {
		return nil, err
	}
	instance, _, _ := moduleHandle.Call(0)
	black, _, _ := stockObject.Call(4) // BLACK_BRUSH
	if instance == 0 || black == 0 {
		return nil, errors.New("privacy window class unavailable")
	}
	class := windowClass{Proc: curtainProc, Instance: instance, Background: black, ClassName: curtainClassName}
	class.Size = uint32(unsafe.Sizeof(class))
	atom, _, err := registerWindowClass.Call(uintptr(unsafe.Pointer(&class)))
	if atom == 0 {
		return nil, err
	}
	return &privacyCurtains{instance: instance, flush: flush, attribute: attribute, windows: make(map[rectangle]uintptr)}, nil
}

func (c *privacyCurtains) newWindow(r rectangle) (uintptr, error) {
	style := uintptr(wsExLayered | wsExTransparent | wsExNoActivate | wsExToolWindow | wsExTopmost)
	hwnd, _, err := createWindow.Call(style, uintptr(unsafe.Pointer(curtainClassName)), 0, wsPopup,
		uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top), 0, 0, c.instance, 0)
	if hwnd == 0 {
		return 0, err
	}
	// Commit a transparent, redirected surface first. No black pixels are shown
	// until capture exclusion has succeeded for every monitor.
	if ok, _, err := setLayer.Call(hwnd, 0, 0, layerAlpha); ok == 0 {
		destroyWindow.Call(hwnd)
		return 0, err
	}
	if err := placeCurtain(hwnd, r); err != nil {
		destroyWindow.Call(hwnd)
		return 0, err
	}
	return hwnd, nil
}

func placeCurtain(hwnd uintptr, r rectangle) error {
	ok, _, err := setWindowPos.Call(hwnd, ^uintptr(0), uintptr(r.Left), uintptr(r.Top),
		uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top), swpNoActivate|swpShowWindow)
	if ok == 0 {
		return err
	}
	return nil
}

func (c *privacyCurtains) present() error {
	if hr, _, _ := c.flush.Call(); int32(hr) < 0 {
		return errors.New("desktop composition unavailable")
	}
	return nil
}

func excludedCurtain(hwnd uintptr) bool {
	var affinity uint32
	ok, _, _ := getAffinity.Call(hwnd, uintptr(unsafe.Pointer(&affinity)))
	return ok != 0 && affinity == excludeFromCapture
}

func (c *privacyCurtains) sync(areas []rectangle, show bool) error {
	wanted := make(map[rectangle]bool, len(areas))
	var added []uintptr
	for _, r := range areas {
		wanted[r] = true
		if c.windows[r] == 0 {
			hwnd, err := c.newWindow(r)
			if err != nil {
				return err
			}
			c.windows[r] = hwnd
			added = append(added, hwnd)
		}
	}
	for r, hwnd := range c.windows {
		if !wanted[r] {
			destroyWindow.Call(hwnd)
			delete(c.windows, r)
		}
	}
	if len(added) > 0 {
		// DWM applies affinity on a composition boundary. Keep the surfaces
		// transparent until both the new windows and their exclusion have landed.
		if err := c.present(); err != nil {
			return err
		}
		for _, hwnd := range added {
			if ok, _, err := setAffinity.Call(hwnd, excludeFromCapture); ok == 0 {
				return err
			}
		}
		if err := c.present(); err != nil {
			return err
		}
	}
	for r, hwnd := range c.windows {
		if !excludedCurtain(hwnd) {
			return errors.New("privacy window capture exclusion unavailable")
		}
		if !show {
			continue
		}
		if ok, _, err := setLayer.Call(hwnd, 0, 255, layerAlpha); ok == 0 {
			return err
		}
		if err := placeCurtain(hwnd, r); err != nil {
			return err
		}
		if ok, _, err := redrawWindow.Call(hwnd, 0, 0, 0x0105); ok == 0 { // RDW_UPDATENOW | RDW_ERASE | RDW_INVALIDATE
			return err
		}
	}
	if show {
		if err := c.present(); err != nil {
			return err
		}
		if !c.covered() {
			return errors.New("incomplete monitor coverage")
		}
	}
	return nil
}

// WS_VISIBLE remains set when the shell cloaks a window on another virtual
// desktop. Loss of presentation must retire the session and all its curtains.
func (c *privacyCurtains) covered() bool {
	for r, hwnd := range c.windows {
		var actual rectangle
		var cloaked uint32
		hr, _, _ := c.attribute.Call(hwnd, 14, uintptr(unsafe.Pointer(&cloaked)), unsafe.Sizeof(cloaked)) // DWMWA_CLOAKED
		ok, _, _ := getWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&actual)))
		visible, _, _ := isWindowVisible.Call(hwnd)
		if int32(hr) < 0 || cloaked != 0 || ok == 0 || visible == 0 || actual != r || !excludedCurtain(hwnd) {
			return false
		}
	}
	return len(c.windows) > 0
}

func (c *privacyCurtains) hasBounds(areas []rectangle) bool {
	if len(areas) != len(c.windows) {
		return false
	}
	for _, r := range areas {
		if c.windows[r] == 0 {
			return false
		}
	}
	return true
}

func (c *privacyCurtains) close() {
	for _, hwnd := range c.windows {
		destroyWindow.Call(hwnd)
	}
	unregisterWindowClass.Call(uintptr(unsafe.Pointer(curtainClassName)), c.instance)
}
