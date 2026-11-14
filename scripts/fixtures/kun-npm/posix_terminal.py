import errno
import fcntl
import os
import pty
import select
import signal
import struct
import termios


class Terminal:
    kind = "posix-pty"

    def __init__(self, node, argv):
        self.pid, self.master = pty.fork()
        if self.pid == 0:
            os.execv(node, [node, *argv])
        fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 120, 0, 0))
        self.code = None

    def read(self, timeout):
        if not select.select([self.master], [], [], timeout)[0]:
            return b""
        try:
            return os.read(self.master, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            return b""

    def write(self, data):
        try:
            os.write(self.master, data)
        except OSError as error:
            if error.errno != errno.EIO:
                raise

    def poll(self):
        if self.code is None:
            waited, status = os.waitpid(self.pid, os.WNOHANG)
            if waited:
                self.code = os.waitstatus_to_exitcode(status)
        return self.code

    def terminate(self):
        os.kill(self.pid, signal.SIGTERM)
        _, status = os.waitpid(self.pid, 0)
        self.code = os.waitstatus_to_exitcode(status)
        return self.code

    def close(self):
        os.close(self.master)

    def finish_output(self):
        result = bytearray()
        while True:
            part = self.read(0.05)
            if not part:
                return bytes(result)
            result.extend(part)
