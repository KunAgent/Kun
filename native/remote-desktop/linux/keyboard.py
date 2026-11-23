"""DOM physical key codes mapped to Linux evdev codes."""
KEYS = {
    "Escape": 1,
    "Minus": 12,
    "Equal": 13,
    "Backspace": 14,
    "Tab": 15,
    "BracketLeft": 26,
    "BracketRight": 27,
    "Enter": 28,
    "ControlLeft": 29,
    "Semicolon": 39,
    "Quote": 40,
    "Backquote": 41,
    "ShiftLeft": 42,
    "Backslash": 43,
    "Comma": 51,
    "Period": 52,
    "Slash": 53,
    "ShiftRight": 54,
    "NumpadMultiply": 55,
    "AltLeft": 56,
    "Space": 57,
    "CapsLock": 58,
    "NumpadSubtract": 74,
    "NumpadAdd": 78,
    "NumpadDecimal": 83,
    "NumpadEnter": 96,
    "ControlRight": 97,
    "NumpadDivide": 98,
    "AltRight": 100,
    "Home": 102,
    "ArrowUp": 103,
    "PageUp": 104,
    "ArrowLeft": 105,
    "ArrowRight": 106,
    "End": 107,
    "ArrowDown": 108,
    "PageDown": 109,
    "Insert": 110,
    "Delete": 111,
    "MetaLeft": 125,
    "MetaRight": 126,
}
for row, start in [("QWERTYUIOP", 16), ("ASDFGHJKL", 30), ("ZXCVBNM", 44)]:
    KEYS.update({"Key" + ch: start + i for i, ch in enumerate(row)})
KEYS.update({"Digit" + ch: i + 2 for i, ch in enumerate("1234567890")})
KEYS.update({"F" + str(i + 1): code for i, code in enumerate([*range(59, 69), 87, 88, *range(183, 195)])})
KEYS.update({"Numpad" + str(i): code for i, code in enumerate([82, 79, 80, 81, 75, 76, 77, 71, 72, 73])})


class HeldInput:
    def __init__(self, device):
        self.device = device
        self.keys = set()
        self.buttons = set()

    def release(self):
        for key in list(self.keys):
            self.device.key(KEYS[key], False)
            self.keys.remove(key)
        for button in list(self.buttons):
            self.device.button(button, False)
            self.buttons.remove(button)

    def send(self, event):
        kind = event["type"]
        if kind == "key":
            key, down = event["code"], event["pressed"]
            self.device.key(KEYS[key], down)
            (self.keys.add if down else self.keys.discard)(key)
        elif kind == "text.commit":
            text = event["text"]
            if len(text.encode("utf-8")) > 1024:
                raise ValueError("oversized text")
            self.device.text(text)
        elif kind in ("pointer.button", "pointer.gameButton"):
            if kind == "pointer.button":
                self.device.absolute(event["x"], event["y"])
            button, down = event["button"], event["pressed"]
            if button not in (0, 1, 2):
                raise ValueError("invalid button")
            self.device.button(button, down)
            (self.buttons.add if down else self.buttons.discard)(button)
        elif kind in ("pointer.move", "pointer.drag"):
            self.device.absolute(event["x"], event["y"])
        elif kind in ("pointer.relative", "pointer.wheel"):
            dx, dy = event["deltaX"], event["deltaY"]
            if not (abs(dx) <= 1200 and abs(dy) <= 1200):
                raise ValueError("invalid delta")
            (self.device.relative if kind == "pointer.relative" else self.device.wheel)(dx, dy)
        else:
            raise ValueError("unknown input")
