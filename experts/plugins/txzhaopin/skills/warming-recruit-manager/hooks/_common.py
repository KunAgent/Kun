"""
Shared utilities for multi-platform Hook scripts.

Supports CodeBuddy, Claude Code (claude-internal), and other AI platforms.
Provides consistent Beacon reporting, device fingerprint generation,
platform auto-detection, and special character escaping across all hooks.

This module ensures the A2 fingerprint algorithm is identical to
skill_tracker/fingerprint.py, so Hook reports and Python SDK reports
produce the same user identifier.
"""

import json
import hashlib
import time
import os
import urllib.request

BEACON_URL = "https://otheve.beacon.qq.com/analytics/v2_upload"

# Placeholder values that indicate app_key has not been configured.
_PLACEHOLDER_APP_KEYS = {"YOUR_APP_KEY", "your_app_key", "YOUR-APP-KEY", ""}

# Module-level directory resolution (computed once, reused by multiple functions)
_HOOKS_DIR = os.path.dirname(os.path.abspath(__file__))
_SKILL_DIR = os.path.dirname(_HOOKS_DIR)


def replace_symbol(value):
    """Replace special characters per Beacon API requirements."""
    if not isinstance(value, str):
        value = str(value)
    return (
        value.replace("|", "%7C")
        .replace("&", "%26")
        .replace("=", "%3D")
        .replace("+", "%2B")
    )


def generate_a2():
    """
    Generate stable device fingerprint.

    IMPORTANT: This algorithm MUST match skill_tracker/fingerprint.py exactly
    to ensure consistent A2 across Hook and Python SDK reports.

    Formula: MD5(hostname:username:device_id)
    Device ID priority: machine-id > MAC address > persistent UUID > "no-device-id"
    """
    import socket
    import getpass
    import uuid
    import platform

    # --- hostname ---
    try:
        hostname = socket.gethostname()
    except Exception:
        hostname = "unknown-host"

    # --- username ---
    try:
        username = getpass.getuser()
    except Exception:
        username = "unknown-user"

    # --- device_id priority chain ---
    device_id = ""

    # Priority 1: machine-id
    for path in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            with open(path, "r") as f:
                mid = f.read().strip()
                if mid:
                    device_id = mid
                    break
        except Exception:
            continue

    if not device_id:
        system = platform.system()
        if system == "Windows":
            try:
                import subprocess
                result = subprocess.run(
                    ["reg", "query",
                     r"HKLM\SOFTWARE\Microsoft\Cryptography",
                     "/v", "MachineGuid"],
                    capture_output=True, text=True, timeout=5,
                )
                if result.returncode == 0:
                    for line in result.stdout.splitlines():
                        if "MachineGuid" in line:
                            parts = line.strip().split()
                            if len(parts) >= 3:
                                device_id = parts[-1]
            except Exception:
                pass
        elif system == "Darwin":
            try:
                import subprocess
                result = subprocess.run(
                    ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                    capture_output=True, text=True, timeout=5,
                )
                if result.returncode == 0:
                    for line in result.stdout.splitlines():
                        if "IOPlatformUUID" in line:
                            parts = line.split("=", 1)
                            if len(parts) == 2:
                                device_id = parts[1].strip().strip('"')
            except Exception:
                pass

    # Priority 2: MAC address
    if not device_id:
        try:
            mac = uuid.getnode()
            if not ((mac >> 40) % 2):
                device_id = ":".join(
                    f"{(mac >> i) & 0xFF:02x}" for i in range(40, -1, -8)
                )
        except Exception:
            pass

    # Priority 3: persistent device-id file
    if not device_id:
        device_id_dir = os.path.join(os.path.expanduser("~"), ".skill-tracker")
        device_id_file = os.path.join(device_id_dir, "device-id")
        try:
            if os.path.isfile(device_id_file):
                with open(device_id_file, "r") as f:
                    did = f.read().strip()
                    if did:
                        device_id = did
        except Exception:
            pass
        if not device_id:
            try:
                os.makedirs(device_id_dir, exist_ok=True)
                did = str(uuid.uuid4())
                with open(device_id_file, "w") as f:
                    f.write(did)
                device_id = did
            except Exception:
                pass

    # Priority 4: final fallback
    if not device_id:
        device_id = "no-device-id"

    fingerprint = f"{hostname}:{username}:{device_id}"
    return hashlib.md5(fingerprint.encode("utf-8")).hexdigest()


def generate_a2_v2():
    """
    Stable device fingerprint v2 — single source of truth across shell + Python.

    Algorithm (identical to tools/report.sh::generate_a2_v2 and
    scripts/track.sh::generate_a2_v2):
        MD5(hostname:username:stable_id)
    where stable_id is resolved with this priority:
        1. /etc/machine-id  /  /var/lib/dbus/machine-id
        2. Windows MachineGuid (HKLM\\SOFTWARE\\Microsoft\\Cryptography)
        3. macOS IOPlatformUUID (ioreg)
        4. ~/.skill-tracker/device-id (auto-generated UUID, persisted)
        5. literal "no-device-id"

    NOTE: v2 deliberately drops MAC / sysfs / ifconfig branches present in
    the legacy generate_a2(). Doing so trades MAC-based stability on
    diskless containers for a guaranteed cross-language consistent hash.
    Both A2 and A2_v2 are reported side-by-side via send_report() so that
    the platform side can A/B compare UV stability before any migration.
    """
    import platform as _plat
    import socket as _sock
    import getpass as _gp
    import uuid as _uuid

    try:
        hostname = _sock.gethostname()
    except Exception:
        hostname = "unknown-host"
    try:
        username = _gp.getuser()
    except Exception:
        username = "unknown-user"

    sid = ""

    # 1. Linux/container machine-id
    for path in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            with open(path, "r") as f:
                v = f.read().strip()
                if v:
                    sid = v
                    break
        except Exception:
            continue

    system = _plat.system()

    # 2. Windows MachineGuid
    if not sid and system == "Windows":
        try:
            import subprocess
            r = subprocess.run(
                ["reg", "query",
                 r"HKLM\SOFTWARE\Microsoft\Cryptography",
                 "/v", "MachineGuid"],
                capture_output=True, text=True, timeout=5,
            )
            if r.returncode == 0:
                for line in r.stdout.splitlines():
                    if "MachineGuid" in line:
                        parts = line.strip().split()
                        if len(parts) >= 3:
                            sid = parts[-1]
                            break
        except Exception:
            pass

    # 3. macOS IOPlatformUUID
    if not sid and system == "Darwin":
        try:
            import subprocess
            r = subprocess.run(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                capture_output=True, text=True, timeout=5,
            )
            if r.returncode == 0:
                for line in r.stdout.splitlines():
                    if "IOPlatformUUID" in line:
                        parts = line.split("=", 1)
                        if len(parts) == 2:
                            sid = parts[1].strip().strip('"')
                            break
        except Exception:
            pass

    # 4. Persistent UUID file (shared with v1 for free interop)
    if not sid:
        did_dir = os.path.join(os.path.expanduser("~"), ".skill-tracker")
        did_file = os.path.join(did_dir, "device-id")
        try:
            if os.path.isfile(did_file):
                with open(did_file, "r") as f:
                    v = f.read().strip()
                    if v:
                        sid = v
        except Exception:
            pass
        if not sid:
            try:
                os.makedirs(did_dir, exist_ok=True)
                v = str(_uuid.uuid4())
                with open(did_file, "w") as f:
                    f.write(v)
                sid = v
            except Exception:
                pass

    # 5. Final fallback
    if not sid:
        sid = "no-device-id"

    fp = f"{hostname}:{username}:{sid}"
    return hashlib.md5(fp.encode("utf-8")).hexdigest()


def _collect_skill_user():
    """Collect person-level user identifier.

    Priority: SKILL_TRACKER_USER env > getpass.getuser() > "unknown"
    """
    user = os.environ.get("SKILL_TRACKER_USER", "")
    if not user:
        try:
            import getpass as _gp
            user = _gp.getuser()
        except Exception:
            user = "unknown"
    return user


def _collect_skill_os():
    """Collect OS name (e.g. Darwin, Linux, Windows)."""
    try:
        import platform as _plat
        return _plat.system() or "unknown"
    except Exception:
        return "unknown"


def _detect_platform():
    """Detect the current runtime platform.

    Returns "codebuddy", "claude-code", "openclaw", "boxai", or "unknown".
    """
    # Claude Code indicators
    if os.environ.get("CLAUDE_CODE_ENTRYPOINT") or os.environ.get("CLAUDE_SKILL_DIR"):
        return "claude-code"
    # Also check for .claude directory (Claude Code project marker)
    if os.path.isdir(os.path.join(_SKILL_DIR, ".claude")):
        return "claude-code"

    # CodeBuddy indicators
    if (os.environ.get("CODEBUDDY_PROJECT_DIR")
            or os.environ.get("CODEBUDDY_ENV")
            or os.environ.get("CODEBUDDY_VERSION")):
        return "codebuddy"
    # NOTE: We intentionally do NOT fall back to a `.codebuddy/` directory
    # check — its presence only means the project once used CodeBuddy hooks,
    # not that the current runtime is CodeBuddy. Runtime env vars are the
    # only trustworthy signal.

    # Other platforms
    # OPENCLAW_SHELL is OpenClaw's officially documented exec-context marker
    # (e.g. OPENCLAW_SHELL=exec) and is more reliable than OPENCLAW_ENV/VERSION.
    if (os.environ.get("OPENCLAW_SHELL")
            or os.environ.get("OPENCLAW_ENV")
            or os.environ.get("OPENCLAW_VERSION")):
        return "openclaw"
    if os.environ.get("BOXAI_ENV") or os.environ.get("BOXAI_VERSION"):
        return "boxai"

    return "unknown"


def _collect_skill_version():
    """Collect skill version from config files.

    Priority: SKILL_VERSION env > pyproject.toml > package.json > VERSION file > empty
    """
    version = os.environ.get("SKILL_VERSION", "")
    if version:
        return version

    # Determine skill directory: hooks/ parent
    hooks_dir = os.path.dirname(os.path.abspath(__file__))
    skill_dir = os.path.dirname(hooks_dir)

    # Try pyproject.toml
    if not version:
        pyproject = os.path.join(skill_dir, "pyproject.toml")
        if os.path.isfile(pyproject):
            try:
                import re
                with open(pyproject, "r") as f:
                    for line in f:
                        m = re.match(r'^version\s*=\s*["\']([^"\']+)["\']', line)
                        if m:
                            version = m.group(1)
                            break
            except Exception:
                pass

    # Try package.json
    if not version:
        pkg_json = os.path.join(_SKILL_DIR, "package.json")
        if os.path.isfile(pkg_json):
            try:
                with open(pkg_json, "r") as f:
                    pkg = json.loads(f.read())
                    version = pkg.get("version", "")
            except Exception:
                pass

    # Try VERSION file
    if not version:
        ver_file = os.path.join(_SKILL_DIR, "VERSION")
        if os.path.isfile(ver_file):
            try:
                with open(ver_file, "r") as f:
                    version = f.read().strip()
            except Exception:
                pass

    return version


def send_report(app_key, skill_name, event_code, extra_data=None, user_id=None):
    """Send event to Beacon API. Never raises exceptions.

    Args:
        app_key: Beacon app key.
        skill_name: Skill name for event grouping.
        event_code: Event identifier.
        extra_data: Optional dict of additional key-value data.
        user_id: Optional user identifier. If provided, written to common.A1.
            Falls back to SKILL_TRACKER_USER_ID environment variable if not provided.
    """
    # Guard: skip reporting if app_key is a placeholder
    if app_key in _PLACEHOLDER_APP_KEYS:
        import sys
        print(
            f"[skill-tracker] WARNING: app_key is not configured (got '{app_key}'). "
            f"Skipping event '{event_code}'. "
            f"Please provide a valid Beacon Appkey. Get one at https://trackmate.woa.com/",
            file=sys.stderr,
        )
        return

    a2 = generate_a2()
    a2_v2 = generate_a2_v2()
    event_time = str(int(time.time() * 1000))

    # Resolve user_id: parameter > environment variable > None
    resolved_user_id = user_id or os.environ.get("SKILL_TRACKER_USER_ID")

    map_value = {
        "skill_name": replace_symbol(skill_name),
        "skill_platform": replace_symbol(_detect_platform()),
        "skill_user": replace_symbol(_collect_skill_user()),
        "skill_os": replace_symbol(_collect_skill_os()),
    }

    # skill_version: omit if not found
    skill_version = _collect_skill_version()
    if skill_version:
        map_value["skill_version"] = replace_symbol(skill_version)

    if extra_data:
        for k, v in extra_data.items():
            map_value[replace_symbol(str(k))] = replace_symbol(str(v))

    # Build common: A2 always present; A2_v2 sidecar for cross-implementation
    # consistency observation (see generate_a2_v2 docstring); A1 only when
    # user_id is resolved.
    common = {"A2": a2, "A2_v2": a2_v2}
    if resolved_user_id:
        common["A1"] = replace_symbol(resolved_user_id)

    payload = {
        "appVersion": "1.0.0",
        "sdkId": "js",
        "sdkVersion": "4.3.4-web",
        "mainAppKey": replace_symbol(app_key),
        "platformId": 3,
        "common": common,
        "events": [
            {
                "eventCode": replace_symbol(event_code),
                "eventTime": event_time,
                "mapValue": {str(k): str(v) for k, v in map_value.items()},
            }
        ],
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            BEACON_URL,
            data=data,
            headers={"Content-Type": "application/json;charset=UTF-8"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=3)
    except Exception:
        pass  # Never block the hook


# --- Session cache utilities ---
SESSION_CACHE_DIR = os.path.expanduser("~/.skill-tracker/sessions")


def save_session_start(session_id):
    """Cache session start time for duration calculation."""
    try:
        os.makedirs(SESSION_CACHE_DIR, exist_ok=True)
        cache_file = os.path.join(SESSION_CACHE_DIR, f"{session_id}.start")
        with open(cache_file, "w") as f:
            f.write(str(time.time()))
    except Exception:
        pass


def get_session_duration(session_id):
    """Calculate session duration from cached start time. Returns seconds as string."""
    cache_file = os.path.join(SESSION_CACHE_DIR, f"{session_id}.start")
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r") as f:
                start_time = float(f.read().strip())
            duration = str(int(time.time() - start_time))
            os.remove(cache_file)
            return duration
        except Exception:
            pass
    return "0"
