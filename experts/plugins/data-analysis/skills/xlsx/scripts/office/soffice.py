"""
Helper for running LibreOffice (soffice) in environments where AF_UNIX
sockets may be blocked (e.g., sandboxed VMs). Detects the restriction
at runtime and applies an LD_PRELOAD shim if needed.

Usage:
    from helpers.soffice import run_soffice, get_soffice_env

    # Option 1: Run soffice directly
    result = run_soffice(["--headless", "--convert-to", "pdf", "input.docx"])

    # Option 2: Get env dict for subprocess calls
    env = get_soffice_env()
    subprocess.run(["soffice", ...], env=env)
"""

import os
import socket
import subprocess
import tempfile
from pathlib import Path

# Compiled shim cached here across calls
_SHIM_PATH = Path(tempfile.gettempdir()) / "lo_socket_shim.so"

_SHIM_SOURCE = r"""
#define _GNU_SOURCE
#include <dlfcn.h>
#include <sys/socket.h>
#include <stdio.h>
#include <errno.h>
#include <unistd.h>

static int (*real_socket)(int, int, int) = NULL;
static int (*real_connect)(int, const struct sockaddr *, socklen_t) = NULL;
static int (*real_bind)(int, const struct sockaddr *, socklen_t) = NULL;
static int (*real_listen)(int, int) = NULL;

static int is_pipe_fd[1024] = {0};

__attribute__((constructor))
static void init(void) {
    real_socket = dlsym(RTLD_NEXT, "socket");
    real_connect = dlsym(RTLD_NEXT, "connect");
    real_bind = dlsym(RTLD_NEXT, "bind");
    real_listen = dlsym(RTLD_NEXT, "listen");
}

int socket(int domain, int type, int protocol) {
    if (domain == AF_UNIX) {
        int fd = real_socket(domain, type, protocol);
        if (fd >= 0) return fd;
        int pipefd[2];
        if (pipe(pipefd) == 0) {
            close(pipefd[1]);
            if (pipefd[0] >= 0 && pipefd[0] < 1024) is_pipe_fd[pipefd[0]] = 1;
            return pipefd[0];
        }
        errno = EPERM;
        return -1;
    }
    return real_socket(domain, type, protocol);
}

int connect(int sockfd, const struct sockaddr *addr, socklen_t addrlen) {
    if (sockfd >= 0 && sockfd < 1024 && is_pipe_fd[sockfd]) {
        errno = ECONNREFUSED;
        return -1;
    }
    return real_connect(sockfd, addr, addrlen);
}

int bind(int sockfd, const struct sockaddr *addr, socklen_t addrlen) {
    if (sockfd >= 0 && sockfd < 1024 && is_pipe_fd[sockfd]) return 0;
    return real_bind(sockfd, addr, addrlen);
}

int listen(int sockfd, int backlog) {
    if (sockfd >= 0 && sockfd < 1024 && is_pipe_fd[sockfd]) return 0;
    return real_listen(sockfd, backlog);
}
"""


def _needs_shim() -> bool:
    """Check if AF_UNIX sockets are blocked."""
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.close()
        return False
    except PermissionError:
        return True


def _ensure_shim() -> Path:
    """Compile the shim .so if not already cached."""
    if _SHIM_PATH.exists():
        return _SHIM_PATH

    src = Path(tempfile.gettempdir()) / "lo_socket_shim.c"
    src.write_text(_SHIM_SOURCE)
    subprocess.run(
        ["gcc", "-shared", "-fPIC", "-o", str(_SHIM_PATH), str(src), "-ldl"],
        check=True,
        capture_output=True,
    )
    src.unlink()
    return _SHIM_PATH


def get_soffice_env() -> dict:
    """
    Return an env dict suitable for running soffice headlessly.

    Always sets SAL_USE_VCLPLUGIN=svp for headless rendering (no X11 needed).
    In sandboxed environments where AF_UNIX sockets are blocked, also adds
    LD_PRELOAD (socket shim) and a fallback DISPLAY.
    """
    env = os.environ.copy()

    # Always use headless VCL plugin - works without X11
    env["SAL_USE_VCLPLUGIN"] = "svp"

    if _needs_shim():
        shim = _ensure_shim()
        env["LD_PRELOAD"] = str(shim)
        env.setdefault("DISPLAY", ":0")

    return env


def run_soffice(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    """
    Run soffice with the given arguments, applying the socket shim
    if needed. Accepts the same keyword arguments as subprocess.run.
    """
    env = get_soffice_env()
    return subprocess.run(["soffice"] + args, env=env, **kwargs)


if __name__ == "__main__":
    import sys
    result = run_soffice(sys.argv[1:])
    sys.exit(result.returncode)
