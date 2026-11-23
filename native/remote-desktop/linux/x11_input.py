import ctypes as C
import ctypes.util
import re
import subprocess


def library(name):
    path = C.util.find_library(name)
    if not path:
        raise RuntimeError("DESKTOP_UNSUPPORTED")
    return C.CDLL(path)


class X11Input:
    def __init__(self):
        self.x = library("X11")
        self.xt = library("Xtst")
        self.x.XOpenDisplay.argtypes = [C.c_char_p]
        self.x.XOpenDisplay.restype = C.c_void_p
        self.display = C.c_void_p(self.x.XOpenDisplay(None))
        if not self.display.value:
            raise RuntimeError("SCREEN_PERMISSION_REQUIRED")
        self.x.XDefaultRootWindow.restype = C.c_ulong
        self.root = C.c_ulong(self.x.XDefaultRootWindow(self.display))
        self.bounds = None
        self.fraction = [0.0, 0.0]

    def configure(self, command):
        bounds = command["bounds"]
        # XRandR reports device pixels even on mixed-DPI layouts.
        output = subprocess.check_output(["xrandr", "--listactivemonitors"], timeout=1, text=True)
        monitors = re.findall(r"(\d+)/(?:\d+)x(\d+)/(?:\d+)([+-]\d+)([+-]\d+)\s+(\S+)", output)
        matches = [
            (int(x), int(y), int(w), int(h)) for w, h, x, y, name in monitors if name == command.get("label")
        ]
        requested = tuple(bounds[k] for k in ("x", "y", "width", "height"))
        if not matches:
            matches = [
                (int(x), int(y), int(w), int(h))
                for w, h, x, y, _ in monitors
                if (int(x), int(y), int(w), int(h)) == requested
            ]
        if len(matches) != 1:
            raise RuntimeError("DESKTOP_SOURCE_CHANGED")
        self.bounds = matches[0]

    def check(self, result):
        if not result:
            raise RuntimeError("DESKTOP_INPUT_FAILED")
        self.x.XSync(self.display, 0)

    def absolute(self, x, y):
        if not (0 <= x <= 1 and 0 <= y <= 1):
            raise ValueError("invalid position")
        left, top, w, h = self.bounds
        self.check(
            self.xt.XTestFakeMotionEvent(
                self.display, -1, left + round(x * (w - 1)), top + round(y * (h - 1)), C.c_ulong(0)
            )
        )

    def cursor(self):
        root, child = C.c_ulong(), C.c_ulong()
        px, py, wx, wy, mask = C.c_int(), C.c_int(), C.c_int(), C.c_int(), C.c_uint()
        ok = self.x.XQueryPointer(
            self.display,
            self.root,
            C.byref(root),
            C.byref(child),
            C.byref(px),
            C.byref(py),
            C.byref(wx),
            C.byref(wy),
            C.byref(mask),
        )
        if not ok:
            raise RuntimeError("DESKTOP_SOURCE_CHANGED")
        return px.value, py.value

    def inside(self, x, y):
        if self.bounds is None:
            return False
        left, top, width, height = self.bounds
        return left <= x < left + width and top <= y < top + height

    def relative(self, x, y):
        px, py = self.cursor()
        if not self.inside(px, py):
            raise RuntimeError("DESKTOP_SOURCE_CHANGED")
        if not self.inside(px + x, py + y):
            left, top, width, height = self.bounds
            nx = min(1, max(0, (px + x - left) / max(1, width - 1)))
            ny = min(1, max(0, (py + y - top) / max(1, height - 1)))
            self.absolute(nx, ny)
            return
        self.check(self.xt.XTestFakeRelativeMotionEvent(self.display, round(x), round(y), C.c_ulong(0)))

    def button(self, n, down):
        if down and not self.inside(*self.cursor()):
            raise RuntimeError("DESKTOP_SOURCE_CHANGED")
        self.check(self.xt.XTestFakeButtonEvent(self.display, [1, 2, 3][n], int(down), C.c_ulong(0)))

    def wheel(self, dx, dy):
        for axis, value in enumerate((dx, dy)):
            self.fraction[axis] += value / 40
            steps = int(self.fraction[axis])
            self.fraction[axis] -= steps
            button = (7 if steps > 0 else 6) if axis == 0 else (5 if steps > 0 else 4)
            for _ in range(abs(steps)):
                for down in (1, 0):
                    self.check(self.xt.XTestFakeButtonEvent(self.display, button, down, C.c_ulong(0)))

    def key(self, code, down):
        self.check(self.xt.XTestFakeKeyEvent(self.display, code + 8, int(down), C.c_ulong(0)))

    def text(self, value):
        subprocess.run(
            ["xdotool", "type", "--delay", "0", "--file", "-"],
            input=value.encode(),
            timeout=1.2,
            check=True,
            stderr=subprocess.DEVNULL,
        )
