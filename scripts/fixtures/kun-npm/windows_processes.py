"""Observe only the requested process trees using Windows Toolhelp/FILETIME."""
import ctypes as c
from ctypes import wintypes as w
import json
import sys


class ENTRY(c.Structure):
    _fields_ = [("size", w.DWORD), ("usage", w.DWORD), ("pid", w.DWORD),
                ("heap", c.c_size_t), ("module", w.DWORD), ("threads", w.DWORD),
                ("parent", w.DWORD), ("priority", w.LONG), ("flags", w.DWORD), ("exe", w.WCHAR * 260)]


kernel = c.WinDLL("kernel32", use_last_error=True)
kernel.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
kernel.CreateToolhelp32Snapshot.restype = w.HANDLE
kernel.Process32FirstW.argtypes = [w.HANDLE, c.POINTER(ENTRY)]
kernel.Process32NextW.argtypes = [w.HANDLE, c.POINTER(ENTRY)]
kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
kernel.OpenProcess.restype = w.HANDLE
kernel.GetProcessTimes.argtypes = [w.HANDLE, *([c.POINTER(w.FILETIME)] * 4)]
kernel.GetExitCodeProcess.argtypes = [w.HANDLE, c.POINTER(w.DWORD)]
kernel.CloseHandle.argtypes = [w.HANDLE]


def birth(pid):
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        error = c.get_last_error()
        if error in (87, 1168):
            return None
        raise c.WinError(error)
    try:
        values = [w.FILETIME() for _ in range(4)]
        code = w.DWORD()
        if not kernel.GetExitCodeProcess(handle, c.byref(code)):
            raise c.WinError(c.get_last_error())
        if code.value != 259:
            return None
        if not kernel.GetProcessTimes(handle, *(c.byref(value) for value in values)):
            raise c.WinError(c.get_last_error())
        return str((values[0].dwHighDateTime << 32) | values[0].dwLowDateTime)
    finally:
        kernel.CloseHandle(handle)


if sys.argv[1] == "--birth":
    print(json.dumps(birth(int(sys.argv[2]))))
else:
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot == c.c_void_p(-1).value:
        raise c.WinError(c.get_last_error())
    try:
        entry = ENTRY()
        entry.size = c.sizeof(ENTRY)
        rows = []
        more = kernel.Process32FirstW(snapshot, c.byref(entry))
        while more:
            rows.append({"pid": entry.pid, "parent": entry.parent})
            more = kernel.Process32NextW(snapshot, c.byref(entry))
        selected = set(map(int, sys.argv[1:]))
        previous = -1
        while previous != len(selected):
            previous = len(selected)
            selected.update(row["pid"] for row in rows if row["parent"] in selected)
        result = []
        for row in rows:
            if row["pid"] in selected:
                identity = birth(row["pid"])
                if identity:
                    result.append({**row, "birth": identity})
        print(json.dumps(result))
    finally:
        kernel.CloseHandle(snapshot)
