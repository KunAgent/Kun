"""Native Windows pseudoconsole transport; only Python's standard library."""
import ctypes as c
from ctypes import wintypes as w
import queue
import subprocess
import threading


class COORD(c.Structure):
    _fields_ = [("X", c.c_short), ("Y", c.c_short)]


class STARTUPINFO(c.Structure):
    _fields_ = [("cb", w.DWORD), ("reserved", w.LPWSTR), ("desktop", w.LPWSTR), ("title", w.LPWSTR),
                ("x", w.DWORD), ("y", w.DWORD), ("x_size", w.DWORD), ("y_size", w.DWORD),
                ("x_chars", w.DWORD), ("y_chars", w.DWORD), ("fill", w.DWORD), ("flags", w.DWORD),
                ("show", w.WORD), ("reserved_size", w.WORD), ("reserved_bytes", c.c_void_p),
                ("stdin", w.HANDLE), ("stdout", w.HANDLE), ("stderr", w.HANDLE)]


class STARTUPINFOEX(c.Structure):
    _fields_ = [("StartupInfo", STARTUPINFO), ("attributes", c.c_void_p)]


class PROCESSINFO(c.Structure):
    _fields_ = [("process", w.HANDLE), ("thread", w.HANDLE), ("pid", w.DWORD), ("tid", w.DWORD)]


kernel = c.WinDLL("kernel32", use_last_error=True)


def bind(name, args, result):
    function = getattr(kernel, name)
    function.argtypes, function.restype = args, result
    return function


pipe = bind("CreatePipe", [c.POINTER(w.HANDLE), c.POINTER(w.HANDLE), c.c_void_p, w.DWORD], w.BOOL)
create_console = bind("CreatePseudoConsole", [COORD, w.HANDLE, w.HANDLE, w.DWORD, c.POINTER(w.HANDLE)], c.c_long)
close_console = bind("ClosePseudoConsole", [w.HANDLE], None)
close_handle = bind("CloseHandle", [w.HANDLE], w.BOOL)
init_attributes = bind("InitializeProcThreadAttributeList", [c.c_void_p, w.DWORD, w.DWORD, c.POINTER(c.c_size_t)], w.BOOL)
set_attribute = bind("UpdateProcThreadAttribute", [c.c_void_p, w.DWORD, c.c_size_t, c.c_void_p, c.c_size_t, c.c_void_p, c.c_void_p], w.BOOL)
delete_attributes = bind("DeleteProcThreadAttributeList", [c.c_void_p], None)
create_process = bind("CreateProcessW", [w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL, w.DWORD,
                                       c.c_void_p, w.LPCWSTR, c.POINTER(STARTUPINFOEX), c.POINTER(PROCESSINFO)], w.BOOL)
read_file = bind("ReadFile", [w.HANDLE, c.c_void_p, w.DWORD, c.POINTER(w.DWORD), c.c_void_p], w.BOOL)
write_file = bind("WriteFile", [w.HANDLE, c.c_void_p, w.DWORD, c.POINTER(w.DWORD), c.c_void_p], w.BOOL)
exit_code = bind("GetExitCodeProcess", [w.HANDLE, c.POINTER(w.DWORD)], w.BOOL)
terminate = bind("TerminateProcess", [w.HANDLE, w.UINT], w.BOOL)
wait = bind("WaitForSingleObject", [w.HANDLE, w.DWORD], w.DWORD)


def checked(value):
    if not value:
        raise c.WinError(c.get_last_error())
    return value


class Terminal:
    kind = "windows-conpty"

    def __init__(self, node, argv):
        self.console = w.HANDLE()
        input_read, self.input_write = w.HANDLE(), w.HANDLE()
        self.output_read, output_write = w.HANDLE(), w.HANDLE()
        checked(pipe(c.byref(input_read), c.byref(self.input_write), None, 0))
        checked(pipe(c.byref(self.output_read), c.byref(output_write), None, 0))
        result = create_console(COORD(120, 30), input_read, output_write, 0, c.byref(self.console))
        if result < 0:
            raise OSError(f"CreatePseudoConsole failed: 0x{result & 0xffffffff:08x}")
        size = c.c_size_t()
        init_attributes(None, 1, 0, c.byref(size))
        self.attributes = c.create_string_buffer(size.value)
        checked(init_attributes(self.attributes, 1, 0, c.byref(size)))
        checked(set_attribute(self.attributes, 0, 0x20016, self.console, c.sizeof(w.HANDLE), None, None))
        startup = STARTUPINFOEX()
        startup.StartupInfo.cb = c.sizeof(STARTUPINFOEX)
        startup.attributes = c.cast(self.attributes, c.c_void_p)
        self.process = PROCESSINFO()
        command = c.create_unicode_buffer(subprocess.list2cmdline([node, *argv]))
        checked(create_process(node, command, None, None, False, 0x80000 | 0x400, None, None,
                               c.byref(startup), c.byref(self.process)))
        close_handle(self.process.thread)
        close_handle(input_read)
        close_handle(output_write)
        self.pid = self.process.pid
        self.output = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        buffer, count = c.create_string_buffer(65536), w.DWORD()
        while read_file(self.output_read, buffer, len(buffer), c.byref(count), None) and count.value:
            self.output.put(buffer.raw[:count.value])

    def read(self, timeout):
        try:
            return self.output.get(timeout=timeout)
        except queue.Empty:
            return b""

    def write(self, data):
        count = w.DWORD()
        checked(write_file(self.input_write, c.create_string_buffer(data), len(data), c.byref(count), None))
        if count.value != len(data):
            raise OSError("Incomplete ConPTY input write")

    def poll(self):
        code = w.DWORD()
        checked(exit_code(self.process.process, c.byref(code)))
        return None if code.value == 259 else code.value

    def terminate(self):
        checked(terminate(self.process.process, 1))
        wait(self.process.process, 10000)
        return self.poll()

    def close(self):
        close_console(self.console)
        close_handle(self.input_write)
        close_handle(self.output_read)
        close_handle(self.process.process)
        delete_attributes(self.attributes)
