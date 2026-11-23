"""One local portal decision binds PipeWire capture and input to the same monitor."""
import os
import struct
import threading
import uuid
import gi

gi.require_version("Gst", "1.0")
from gi.repository import Gio, GLib, Gst

BUS = "org.freedesktop.portal.Desktop"
PATH = "/org/freedesktop/portal/desktop"
REMOTE = "org.freedesktop.portal.RemoteDesktop"
CAST = "org.freedesktop.portal.ScreenCast"


class Portal:
    def __init__(self):
        Gst.init(None)
        if not all(
            Gst.ElementFactory.find(name)
            for name in ("pipewiresrc", "appsink", "videoconvert", "videoscale", "videorate")
        ):
            raise RuntimeError("DESKTOP_UNSUPPORTED")
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.sender = self.bus.get_unique_name()[1:].replace(".", "_")
        self.session = None
        self.pipeline = None
        self.fd = None
        self.wanted = threading.Event()
        self.closed = False

    def call(self, interface, method, params):
        return self.bus.call_sync(
            BUS, PATH, interface, method, params, None, Gio.DBusCallFlags.NONE, 2000, None
        )

    def request(self, interface, method, signature, arguments, options):
        token = "kun" + uuid.uuid4().hex
        options["handle_token"] = GLib.Variant("s", token)
        path = PATH + "/request/" + self.sender + "/" + token
        loop = GLib.MainLoop()
        result = []

        def response(bus, sender, path, iface, name, params, *_user_data):
            result.append(params.unpack())
            loop.quit()

        subscription = self.bus.signal_subscribe(
            BUS, "org.freedesktop.portal.Request", "Response", path, None, Gio.DBusSignalFlags.NONE, response
        )
        timeout = GLib.timeout_add_seconds(90, lambda: (loop.quit(), False)[1])
        try:
            self.call(interface, method, GLib.Variant(signature, (*arguments, options)))
            if not result:
                loop.run()
            if not result or result[0][0] != 0:
                raise RuntimeError("SCREEN_PERMISSION_REQUIRED")
            return result[0][1]
        finally:
            self.bus.signal_unsubscribe(subscription)
            if result:
                GLib.source_remove(timeout)

    def open(self):
        options = {"session_handle_token": GLib.Variant("s", "kun" + uuid.uuid4().hex)}
        self.session = self.request(REMOTE, "CreateSession", "(a{sv})", (), options)["session_handle"]
        self.bus.signal_subscribe(
            BUS,
            "org.freedesktop.portal.Session",
            "Closed",
            self.session,
            None,
            Gio.DBusSignalFlags.NONE,
            lambda *args: setattr(self, "closed", True),
        )
        self.request(REMOTE, "SelectDevices", "(oa{sv})", (self.session,), {"types": GLib.Variant("u", 3)})
        self.request(
            CAST,
            "SelectSources",
            "(oa{sv})",
            (self.session,),
            {"types": GLib.Variant("u", 1), "multiple": GLib.Variant("b", False)},
        )
        selected = self.request(REMOTE, "Start", "(osa{sv})", (self.session, ""), {})
        streams = selected.get("streams", [])
        if len(streams) != 1:
            raise RuntimeError("DESKTOP_SOURCE_CHANGED")
        self.node, props = streams[0]
        if props.get("source_type", 1) != 1:
            raise RuntimeError("DESKTOP_SOURCE_CHANGED")
        self.w, self.h = props["size"]
        if not (1 <= self.w <= 32768 and 1 <= self.h <= 32768):
            raise RuntimeError("DESKTOP_SOURCE_CHANGED")
        scale = min(1, 1920 / self.w, 1080 / self.h)
        self.width = max(8, int(self.w * scale) // 8 * 8)
        self.height = max(2, int(self.h * scale) // 2 * 2)
        self.devices = selected.get("devices", 0)
        return {
            "width": self.width,
            "height": self.height,
            "logicalWidth": self.w,
            "logicalHeight": self.h,
            "input": (self.devices & 3) == 3,
        }

    def configure(self, command):
        if not self.session or command["displayId"] != 2147483600:
            raise RuntimeError("DESKTOP_SOURCE_CHANGED")

    def start_video(self):
        if self.pipeline:
            return
        result, fds = self.bus.call_with_unix_fd_list_sync(
            BUS,
            PATH,
            CAST,
            "OpenPipeWireRemote",
            GLib.Variant("(oa{sv})", (self.session, {})),
            GLib.VariantType.new("(h)"),
            Gio.DBusCallFlags.NONE,
            2000,
            None,
            None,
        )
        self.fd = fds.get(result.unpack()[0])
        pipeline = Gst.parse_launch(
            f"pipewiresrc fd={self.fd} path={self.node} do-timestamp=true ! queue max-size-buffers=1 leaky=downstream "
            f"! videoconvert ! videoscale ! videorate drop-only=true ! video/x-raw,format=I420,width={self.width},height={self.height},framerate=60/1 "
            "! appsink name=frames sync=false emit-signals=true max-buffers=1 drop=true"
        )
        self.pipeline = pipeline
        bus = pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect("message::error", lambda *_: setattr(self, "closed", True))
        bus.connect("message::eos", lambda *_: setattr(self, "closed", True))
        self.wanted.set()
        pipeline.get_by_name("frames").connect("new-sample", self.frame)
        if pipeline.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
            raise RuntimeError("DESKTOP_CAPTURE_FAILED")

    def frame(self, sink):
        sample = sink.emit("pull-sample")
        if not sample or not self.wanted.is_set():
            return Gst.FlowReturn.OK
        self.wanted.clear()
        buf = sample.get_buffer()
        size = buf.get_size()
        if size != self.width * self.height * 3 // 2:
            return Gst.FlowReturn.ERROR
        packet = memoryview(struct.pack(">I", size) + buf.extract_dup(0, size))
        try:
            while packet:
                packet = packet[os.write(3, packet) :]
        except OSError:
            return Gst.FlowReturn.ERROR
        return Gst.FlowReturn.OK

    def stop_video(self):
        self.wanted.clear()
        if self.pipeline:
            self.pipeline.get_bus().remove_signal_watch()
            self.pipeline.set_state(Gst.State.NULL)
            self.pipeline = None
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def notify(self, method, signature, *values):
        self.call(REMOTE, method, GLib.Variant("(oa{sv}" + signature + ")", (self.session, {}, *values)))

    def absolute(self, x, y):
        if not (0 <= x <= 1 and 0 <= y <= 1):
            raise ValueError("invalid position")
        self.notify("NotifyPointerMotionAbsolute", "udd", self.node, x * (self.w - 1), y * (self.h - 1))

    def relative(self, x, y):
        self.notify("NotifyPointerMotion", "dd", float(x), float(y))

    def button(self, n, down):
        self.notify("NotifyPointerButton", "iu", [272, 274, 273][n], int(down))

    def wheel(self, x, y):
        self.notify("NotifyPointerAxis", "dd", float(x), float(y))

    def key(self, code, down):
        self.notify("NotifyKeyboardKeycode", "iu", code, int(down))

    def text(self, value):
        for ch in value:
            sym = ord(ch) if ord(ch) <= 255 else 0x1000000 | ord(ch)
            for state in (1, 0):
                self.notify("NotifyKeyboardKeysym", "iu", sym, state)
