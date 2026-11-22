"""Bind cleanup to the verified Electron renderer, including across PID reuse."""
import os
import select
import signal
from pathlib import Path


def process_info(pid):
    if pid <= 1:
        raise ValueError("invalid pid")
    proc = Path("/proc") / str(pid)
    text = (proc / "stat").read_text()
    fields = text[text.rindex(")") + 2 :].split()
    return proc.stat().st_uid, int(fields[1]), fields[19] + ":0", fields[0]


class Renderer:
    def __init__(self, pid, birth):
        self.fd = os.pidfd_open(pid)
        try:
            uid, ancestor, actual, _ = process_info(pid)
            if uid != os.getuid() or pid in (os.getpid(), os.getppid()) or actual != birth:
                raise ValueError("invalid renderer")
            for _ in range(12):
                if ancestor == os.getppid():
                    break
                uid, ancestor, _, _ = process_info(ancestor)
                if uid != os.getuid():
                    raise ValueError("invalid owner")
            else:
                raise ValueError("renderer is unrelated")
            if process_info(pid)[2] != birth:
                raise ValueError("identity changed")
        except BaseException:
            os.close(self.fd)
            raise

    def end(self):
        if not select.select([self.fd], [], [], 0)[0]:
            try:
                signal.pidfd_send_signal(self.fd, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if not select.select([self.fd], [], [], 1)[0]:
            raise RuntimeError("DESKTOP_CLEANUP_UNCONFIRMED")

    def close(self):
        os.close(self.fd)


class LoginSession:
    def __init__(self):
        from gi.repository import Gio, GLib

        self.Gio, self.GLib = Gio, GLib
        self.bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)

        def session(method, args):
            return self.bus.call_sync(
                "org.freedesktop.login1",
                "/org/freedesktop/login1",
                "org.freedesktop.login1.Manager",
                method,
                args,
                None,
                Gio.DBusCallFlags.NONE,
                1500,
                None,
            ).unpack()[0]

        try:
            self.path = session("GetSessionByPID", GLib.Variant("(u)", (os.getpid(),)))
        except GLib.Error:
            self.path = session("GetSession", GLib.Variant("(s)", (os.environ["XDG_SESSION_ID"],)))

    def active(self):
        info = self.bus.call_sync(
            "org.freedesktop.login1",
            self.path,
            "org.freedesktop.DBus.Properties",
            "GetAll",
            self.GLib.Variant("(s)", ("org.freedesktop.login1.Session",)),
            None,
            self.Gio.DBusCallFlags.NONE,
            1000,
            None,
        )
        values = info.unpack()[0]
        return (
            values.get("User", (-1,))[0] == os.getuid()
            and values.get("Active") is True
            and values.get("LockedHint") is False
            and values.get("State") == "active"
        )
