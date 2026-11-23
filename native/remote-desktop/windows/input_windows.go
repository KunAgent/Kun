package main

import (
	"math"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

var user32 = syscall.NewLazyDLL("user32.dll")
var sendInput = user32.NewProc("SendInput")
var getMetrics = user32.NewProc("GetSystemMetrics")
var getCursorPos = user32.NewProc("GetCursorPos")
var monitorFromRect = user32.NewProc("MonitorFromRect")
var getMonitorInfo = user32.NewProc("GetMonitorInfoW")
var wts = syscall.NewLazyDLL("wtsapi32.dll")
var querySession = wts.NewProc("WTSQuerySessionInformationW")
var freeSession = wts.NewProc("WTSFreeMemory")
var openInputDesktop = user32.NewProc("OpenInputDesktop")
var getObjectInfo = user32.NewProc("GetUserObjectInformationW")
var closeDesktop = user32.NewProc("CloseDesktop")

type rectangle struct{ Left, Top, Right, Bottom int32 }
type point struct{ X, Y int32 }
type geometry struct{ X, Y, Width, Height int32 }
type monitorInfo struct {
	Size          uint32
	Monitor, Work rectangle
	Flags         uint32
}
type inputRecord struct {
	Kind uint32
	Pad  uint32
	Data [32]byte
}
type mouseData struct {
	X, Y        int32
	Data, Flags uint32
}
type keyData struct {
	VK, Scan uint16
	Flags    uint32
}
type inputEvent struct {
	Type, Code, Text     string
	X, Y, DeltaX, DeltaY float64
	Button               int
	Pressed              bool
}

var keys = map[string]uint16{
	"Escape": 1, "Backquote": 41, "Minus": 12, "Equal": 13, "Backspace": 14, "Tab": 15,
	"BracketLeft": 26, "BracketRight": 27, "Enter": 28, "ControlLeft": 29, "Semicolon": 39, "Quote": 40,
	"ShiftLeft": 42, "Backslash": 43, "Comma": 51, "Period": 52, "Slash": 53, "ShiftRight": 54,
	"AltLeft": 56, "Space": 57, "CapsLock": 58, "MetaLeft": 0x15b, "MetaRight": 0x15c,
	"ControlRight": 0x11d, "AltRight": 0x138, "Insert": 0x152, "Delete": 0x153, "Home": 0x147, "End": 0x14f,
	"PageUp": 0x149, "PageDown": 0x151, "ArrowUp": 0x148, "ArrowDown": 0x150, "ArrowLeft": 0x14b, "ArrowRight": 0x14d,
	"NumpadEnter": 0x11c, "NumpadDivide": 0x135, "NumpadMultiply": 55, "NumpadAdd": 78, "NumpadSubtract": 74, "NumpadDecimal": 83,
}

func init() {
	for _, row := range []struct {
		letters string
		scan    int
	}{{"QWERTYUIOP", 16}, {"ASDFGHJKL", 30}, {"ZXCVBNM", 44}} {
		for i, letter := range row.letters {
			keys["Key"+string(letter)] = uint16(row.scan + i)
		}
	}
	for i, digit := range "1234567890" {
		keys["Digit"+string(digit)] = uint16(i + 2)
	}
	for i, scan := range []uint16{82, 79, 80, 81, 75, 76, 77, 71, 72, 73} {
		keys["Numpad"+string(rune('0'+i))] = scan
	}
	for i, scan := range []uint16{59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88} {
		keys[functionKey(i+1)] = scan
	}
}
func processEntrySize() uintptr { return unsafe.Sizeof(syscall.ProcessEntry32{}) }
func defaultDesktop() bool {
	var state *uint32
	var size uint32
	okSession, _, _ := querySession.Call(0, 0xffffffff, 8, uintptr(unsafe.Pointer(&state)), uintptr(unsafe.Pointer(&size)))
	if okSession == 0 || state == nil {
		return false
	}
	active := size >= 4 && *state == 0
	freeSession.Call(uintptr(unsafe.Pointer(state)))
	if !active {
		return false
	}
	h, _, _ := openInputDesktop.Call(0, 0, 1)
	if h == 0 {
		return false
	}
	defer closeDesktop.Call(h)
	var name [64]uint16
	var length uint32
	ok, _, _ := getObjectInfo.Call(h, 2, uintptr(unsafe.Pointer(&name[0])), unsafe.Sizeof(name), uintptr(unsafe.Pointer(&length)))
	return ok != 0 && syscall.UTF16ToString(name[:]) == "Default"
}
func (g geometry) valid() bool {
	if g.Width < 1 || g.Height < 1 {
		return false
	}
	r := rectangle{g.X, g.Y, g.X + g.Width, g.Y + g.Height}
	h, _, _ := monitorFromRect.Call(uintptr(unsafe.Pointer(&r)), 0)
	var info monitorInfo
	info.Size = uint32(unsafe.Sizeof(info))
	ok, _, _ := getMonitorInfo.Call(h, uintptr(unsafe.Pointer(&info)))
	return h != 0 && ok != 0 && info.Monitor == r
}
func submit(in *inputRecord) bool {
	n, _, _ := sendInput.Call(1, uintptr(unsafe.Pointer(in)), unsafe.Sizeof(*in))
	return n == 1
}
func mouse(x, y int32, data int32, flags uint32) bool {
	var in inputRecord
	*(*mouseData)(unsafe.Pointer(&in.Data[0])) = mouseData{x, y, uint32(data), flags}
	return submit(&in)
}
func key(scan uint16, down, unicode bool) bool {
	var in inputRecord
	in.Kind = 1
	flags := uint32(8)
	if unicode {
		flags = 4
	} else if scan > 255 {
		flags |= 1
		scan &= 255
	}
	if !down {
		flags |= 2
	}
	*(*keyData)(unsafe.Pointer(&in.Data[0])) = keyData{0, scan, flags}
	return submit(&in)
}
func metric(index uintptr) int32 { v, _, _ := getMetrics.Call(index); return int32(v) }
func (g geometry) inside(p point) bool {
	return p.X >= g.X && p.Y >= g.Y && p.X < g.X+g.Width && p.Y < g.Y+g.Height
}
func (g geometry) absolute(x, y float64) bool {
	if x < 0 || x > 1 || y < 0 || y > 1 {
		return false
	}
	w, h := metric(78), metric(79)
	if w < 2 || h < 2 {
		return false
	}
	nx := float64(g.X-metric(76)) + math.Round(x*float64(g.Width-1))
	ny := float64(g.Y-metric(77)) + math.Round(y*float64(g.Height-1))
	return mouse(int32(math.Round(nx*65535/float64(w-1))), int32(math.Round(ny*65535/float64(h-1))), 0, 0xc001)
}

var downFlags = []uint32{2, 0x20, 8}
var upFlags = []uint32{4, 0x40, 0x10}

func (s *session) input(e inputEvent) bool {
	if !defaultDesktop() || !s.bounds.valid() {
		return false
	}
	switch e.Type {
	case "key":
		scan, ok := keys[e.Code]
		if !ok || !key(scan, e.Pressed, false) {
			return false
		}
		if e.Pressed {
			s.keys[e.Code] = true
		} else {
			delete(s.keys, e.Code)
		}
		return true
	case "text.commit":
		if len(e.Text) > 1024 {
			return false
		}
		for _, unit := range utf16.Encode([]rune(e.Text)) {
			if !key(unit, true, true) || !key(unit, false, true) {
				return false
			}
		}
		return true
	case "pointer.move", "pointer.drag":
		return s.bounds.absolute(e.X, e.Y)
	case "pointer.relative", "pointer.gameButton", "pointer.wheel":
		var pos point
		ok, _, _ := getCursorPos.Call(uintptr(unsafe.Pointer(&pos)))
		if ok == 0 || !s.bounds.inside(pos) {
			return false
		}
		if e.Type == "pointer.relative" {
			if math.Abs(e.DeltaX) > 1200 || math.Abs(e.DeltaY) > 1200 {
				return false
			}
			return mouse(int32(e.DeltaX), int32(e.DeltaY), 0, 1)
		}
		if e.Type == "pointer.wheel" {
			return (e.DeltaY == 0 || mouse(0, 0, -int32(e.DeltaY), 0x800)) && (e.DeltaX == 0 || mouse(0, 0, int32(e.DeltaX), 0x1000))
		}
	case "pointer.button":
		if !s.bounds.absolute(e.X, e.Y) {
			return false
		}
	default:
		return false
	}
	if e.Button < 0 || e.Button >= len(upFlags) {
		return false
	}
	flags := upFlags[e.Button]
	if e.Pressed {
		flags = downFlags[e.Button]
	}
	if !mouse(0, 0, 0, flags) {
		return false
	}
	if e.Pressed {
		s.buttons[e.Button] = true
	} else {
		delete(s.buttons, e.Button)
	}
	return true
}
func (s *session) release() bool {
	for code := range s.keys {
		scan, ok := keys[code]
		if !ok || !key(scan, false, false) {
			return false
		}
		delete(s.keys, code)
	}
	for which := range s.buttons {
		if which < 0 || which > 2 || !mouse(0, 0, 0, upFlags[which]) {
			return false
		}
		delete(s.buttons, which)
	}
	return true
}
