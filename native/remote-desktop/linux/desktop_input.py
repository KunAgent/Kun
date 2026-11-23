#!/usr/bin/python3
import json
import os
import select
import shutil
import signal
import sys
import time
from process_guard import LoginSession, Renderer, process_info
from keyboard import HeldInput


def output(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


def run_session(portal):
    from gi.repository import GLib

    login = LoginSession()
    if not login.active():
        raise RuntimeError("HOST_INACTIVE")
    if portal:
        from wayland_portal import Portal

        device = Portal()
        info = device.open()
        output({"event": "portal", "value": info})
    else:
        from x11_input import X11Input

        device = X11Input()
    held = HeldInput(device)
    renderer = None
    deadline = time.monotonic() + 15
    setup = True
    parent = os.getppid()
    last_privacy = 0
    pending = bytearray()
    context = GLib.MainContext.default()

    def cleanup():
        nonlocal renderer
        held.release()
        if portal:
            device.stop_video()
        if renderer:
            renderer.close()
            renderer = None

    try:
        while True:
            while context.pending():
                context.iteration(False)
            now = time.monotonic()
            if (
                portal
                and device.closed
                or parent <= 1
                or os.getppid() != parent
                or (renderer or not portal)
                and now >= deadline
            ):
                break
            if now - last_privacy >= 0.35:
                if not login.active():
                    break
                last_privacy = now
            if not select.select([0], [], [], 0.025)[0]:
                continue
            chunk = os.read(0, 8192)
            if not chunk:
                break
            pending.extend(chunk)
            while b"\n" in pending:
                line, _, rest = pending.partition(b"\n")
                pending = bytearray(rest)
                if len(line) > 8192:
                    raise ValueError("oversized request")
                req = json.loads(line)
                op = req["operation"]
                ident = req["id"]
                try:
                    if op == "configure" and renderer is None:
                        if not login.active():
                            raise RuntimeError("DESKTOP_AUTHORITY_CHANGED")
                        device.configure(req)
                        renderer = Renderer(req["capturePid"], req["captureBirth"])
                        deadline = time.monotonic() + 15
                        setup = True
                    elif op in ("lease", "setupLease") and renderer:
                        if op == "setupLease" and not setup or time.monotonic() >= deadline:
                            raise RuntimeError("DESKTOP_SESSION_EXPIRED")
                        bound = 15 if op == "setupLease" else 6
                        until = time.monotonic() + max(0, min(bound, req["remainingMs"] / 1000))
                        deadline = min(until, deadline) if op == "setupLease" else until
                        setup = op == "setupLease"
                    elif op == "ready" and renderer:
                        if portal and device.devices & 3 != 3:
                            raise RuntimeError("INPUT_PERMISSION_REQUIRED")
                    elif op == "input" and renderer and time.monotonic() < deadline:
                        held.send(req["event"])
                    elif op == "video" and portal and renderer:
                        device.start_video()
                    elif op == "frame" and portal and renderer:
                        device.wanted.set()
                    elif op == "release":
                        held.release()
                    elif op == "stop":
                        cleanup()
                    else:
                        raise ValueError("invalid operation")
                    output({"id": ident, "ok": True})
                    if op == "stop" and not portal:
                        return
                except Exception as error:
                    code = str(error)
                    output(
                        {
                            "id": ident,
                            "error": code
                            if code.startswith(("DESKTOP_", "INPUT_"))
                            else "DESKTOP_INPUT_FAILED",
                        }
                    )
            if len(pending) > 8192:
                break
    finally:
        try:
            held.release()
        finally:
            if renderer:
                try:
                    renderer.end()
                finally:
                    renderer.close()


def main(args):
    if len(args) == 2 and args[0] == "--identity":
        print(process_info(int(args[1]))[2])
    elif len(args) == 3 and args[0] == "--terminate":
        try:
            renderer = Renderer(int(args[1]), args[2])
        except ProcessLookupError:
            return
        except FileNotFoundError:
            return
        renderer.end()
        renderer.close()
    elif len(args) == 4 and args[0] == "--system-audio":
        from system_output import capture_audio

        capture_audio(int(args[2]), args[3])
    elif args == ["--release-only"]:
        data = json.loads(sys.stdin.buffer.readline(8193))
        if data == {"keys": [], "buttons": []}:
            return
        from x11_input import X11Input

        held = HeldInput(X11Input())
        held.keys = set(data["keys"])
        held.buttons = set(data["buttons"])
        if len(held.keys) > 64 or not held.buttons.issubset({0, 1, 2}):
            raise ValueError("invalid ledger")
        held.release()
    elif args == ["--probe"]:
        from gi.repository import Gio

        if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            raise RuntimeError("DESKTOP_UNSUPPORTED")
        if os.environ.get("XDG_SESSION_TYPE") == "wayland" or os.environ.get("WAYLAND_DISPLAY"):
            from wayland_portal import Portal

            Portal()
        else:
            from x11_input import X11Input

            X11Input()
            if not shutil.which("xrandr") or not shutil.which("xdotool"):
                raise RuntimeError("DESKTOP_UNSUPPORTED")
        print("kun-linux-desktop-v1")
    elif args == ["--watch-session"]:
        login = LoginSession()
        while login.active() and not select.select([0], [], [], 0.35)[0]:
            pass
    elif args in ([], ["--portal"]):
        run_session(bool(args))
    else:
        raise ValueError("invalid operation")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception:
        sys.exit(3)
