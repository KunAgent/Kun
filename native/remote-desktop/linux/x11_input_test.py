import subprocess
import unittest
from x11_input import X11Input
from keyboard import HeldInput


class GrantedDisplay(unittest.TestCase):
    """CI uses a private Xvfb display containing only this test."""

    def test_mouse_and_release(self):
        source = X11Input()
        shape = subprocess.check_output(["xdotool", "getdisplaygeometry"], text=True).split()
        width, height = map(int, shape)
        source.configure({"bounds": {"x": 0, "y": 0, "width": width, "height": height}})
        held = HeldInput(source)
        held.send({"type": "pointer.move", "x": 0.5, "y": 0.5})
        location = subprocess.check_output(["xdotool", "getmouselocation", "--shell"], text=True)
        self.assertIn("X=" + str(round((width - 1) / 2)), location)
        held.send({"type": "key", "code": "ShiftLeft", "pressed": True})
        held.send({"type": "pointer.gameButton", "button": 0, "pressed": True})
        held.release()
        self.assertFalse(held.keys or held.buttons)
