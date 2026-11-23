"""Capture the playback monitor through PipeWire-Pulse or PulseAudio in this process."""
import ctypes as C
import ctypes.util
import os
import select
import threading
from process_guard import Renderer


class SampleSpec(C.Structure):
    _fields_ = [("format", C.c_int), ("rate", C.c_uint32), ("channels", C.c_uint8)]


class Buffers(C.Structure):
    _fields_ = [(field, C.c_uint32) for field in ("maxlength", "tlength", "prebuf", "minreq", "fragsize")]


def capture_audio(pid, birth):
    renderer = Renderer(pid, birth)
    parent = os.getppid()

    def watch():
        while parent > 1 and os.getppid() == parent and not select.select([renderer.fd], [], [], 0.2)[0]:
            pass
        os._exit(0)

    threading.Thread(target=watch, daemon=True).start()
    library = C.util.find_library("pulse-simple")
    if not library:
        raise RuntimeError("DESKTOP_AUDIO_UNAVAILABLE")
    pulse = C.CDLL(library)
    pulse.pa_simple_new.argtypes = [
        C.c_char_p,
        C.c_char_p,
        C.c_int,
        C.c_char_p,
        C.c_char_p,
        C.POINTER(SampleSpec),
        C.c_void_p,
        C.POINTER(Buffers),
        C.POINTER(C.c_int),
    ]
    pulse.pa_simple_new.restype = C.c_void_p
    pulse.pa_simple_read.argtypes = [C.c_void_p, C.c_void_p, C.c_size_t, C.POINTER(C.c_int)]
    pulse.pa_simple_free.argtypes = [C.c_void_p]
    error = C.c_int()
    spec = SampleSpec(5, 48000, 2)
    buffers = Buffers(0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 3840)
    stream = pulse.pa_simple_new(
        None,
        b"Kun",
        2,
        b"@DEFAULT_MONITOR@",
        b"Kun desktop playback",
        C.byref(spec),
        None,
        C.byref(buffers),
        C.byref(error),
    )
    if not stream:
        raise RuntimeError("DESKTOP_AUDIO_UNAVAILABLE")
    try:
        packet = C.create_string_buffer(3840)
        os.write(3, b"R")
        while pulse.pa_simple_read(stream, packet, len(packet), C.byref(error)) == 0:
            data = memoryview(packet.raw)
            while data:
                data = data[os.write(1, data) :]
    finally:
        pulse.pa_simple_free(stream)
        renderer.close()
