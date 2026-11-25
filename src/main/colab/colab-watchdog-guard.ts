import type {
  ColabConnectionView,
  ColabGuardStopReason,
  ColabGuardWarningKind,
  ColabSessionView
} from '../../shared/colab/colab-types'

export const KUN_COLAB_WATCHDOG_DIR = '/root/.kun-colab'
export const KUN_COLAB_HEARTBEAT_PATH = '/root/.kun-colab/heartbeat'
export const USAGE_STALE_AFTER_MS = 5 * 60 * 1000
export const GUARD_WARN_FRACTION = 0.8

/**
 * Detached stdlib-only Python watchdog running inside the Colab VM.
 * Survives host disconnects and app exits, releasing the VM via
 * `POST http://$TBE_RUNTIME_ADDR/unassign` when the absolute deadline or
 * idle rule (no kernel heartbeat AND GPU utilization < 5%) expires.
 */
const VM_WATCHDOG_SCRIPT = `#!/usr/bin/env python3
import json, os, signal, subprocess, sys, time, urllib.request

GPU_BUSY_PCT = 5.0

def gpu_util():
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=15, check=True,
        ).stdout
        vals = [float(x.strip()) for x in out.splitlines() if x.strip()]
        return max(vals) if vals else None
    except Exception:
        return None

def find_runtime_addr(cfg):
    addr = cfg.get("runtime_addr") or os.environ.get("TBE_RUNTIME_ADDR")
    if addr:
        return addr
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/environ", "rb") as fh:
                for item in fh.read().split(b"\\0"):
                    if item.startswith(b"TBE_RUNTIME_ADDR="):
                        return item.split(b"=", 1)[1].decode("utf-8", "ignore")
        except OSError:
            continue
    return None

def flush_drive():
    try:
        os.sync()
    except Exception:
        pass
    cands = ["/content/drive"]
    try:
        mp_cfg = "/root/.config/Google/DriveFS/mount_point"
        if os.path.isfile(mp_cfg):
            p = open(mp_cfg, "r", encoding="utf-8", errors="ignore").read().strip()
            if p and p not in cands:
                cands.append(p)
    except OSError:
        pass
    try:
        with open("/proc/mounts", "r", encoding="utf-8", errors="ignore") as mf:
            for ln in mf:
                ps = ln.split()
                if len(ps) >= 3 and (ps[2].startswith("fuse") or ps[0] == "drive"):
                    mp = ps[1].replace("\\\\040", " ")
                    if mp not in cands:
                        cands.append(mp)
    except OSError:
        pass
    mounted = False
    for mp in cands:
        mp = mp.rstrip("/") or "/"
        if mp == "/":
            continue
        try:
            pdev = os.stat(os.path.dirname(mp) or "/").st_dev
            for root in (mp + "/MyDrive", mp + "/My Drive"):
                if os.path.isdir(root) and (os.path.ismount(mp) or os.stat(root).st_dev != pdev):
                    mounted = True
                    break
            if mounted:
                break
        except OSError:
            continue
    if mounted:
        try:
            subprocess.run(
                [sys.executable, "-c", "from google.colab import drive; drive.flush_and_unmount()"],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=120,
            )
        except Exception:
            pass

def unassign(addr):
    if not addr:
        return False
    flush_drive()
    url = f"http://{addr}/unassign"
    for _ in range(3):
        try:
            req = urllib.request.Request(url, data=b"", method="POST")
            with urllib.request.urlopen(req, timeout=15) as resp:
                if 200 <= resp.status < 300:
                    return True
        except Exception:
            time.sleep(2)
    return False

def main():
    cfg_path = sys.argv[1]
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    started = time.time()
    last_gpu_busy = started
    while True:
        try:
            with open(cfg_path, "r", encoding="utf-8") as fh:
                cfg = json.load(fh)
        except Exception:
            cfg = {}
        if cfg.get("cancelled"):
            return 0
        now = time.time()
        g = gpu_util()
        if g is not None and g >= GPU_BUSY_PCT:
            last_gpu_busy = now
        deadline = cfg.get("deadline_epoch")
        if isinstance(deadline, (int, float)) and deadline > 0 and now >= deadline:
            if unassign(find_runtime_addr(cfg)):
                return 0
        idle_s = cfg.get("idle_timeout_s")
        if isinstance(idle_s, (int, float)) and idle_s > 0:
            hb_path = cfg.get("heartbeat") or "/root/.kun-colab/heartbeat"
            try:
                hb_mtime = os.path.getmtime(hb_path)
            except OSError:
                hb_mtime = started
            last_active = max(started, hb_mtime, last_gpu_busy)
            if now - last_active >= idle_s:
                if unassign(find_runtime_addr(cfg)):
                    return 0
        time.sleep(15)

if __name__ == "__main__":
    sys.exit(main())
`

export function buildInstallVmWatchdogPython(params: {
  maxRuntimeSeconds: number | null
  idleTimeoutSeconds: number | null
}): string {
  const payload = JSON.stringify({
    script: VM_WATCHDOG_SCRIPT,
    maxRuntimeSeconds:
      params.maxRuntimeSeconds && params.maxRuntimeSeconds > 0 ? params.maxRuntimeSeconds : null,
    idleTimeoutSeconds:
      params.idleTimeoutSeconds && params.idleTimeoutSeconds > 0 ? params.idleTimeoutSeconds : null
  })
  return `import datetime, json, os, signal, subprocess, sys, time
p = json.loads(${JSON.stringify(payload)})
d = "${KUN_COLAB_WATCHDOG_DIR}"
os.makedirs(d, mode=0o700, exist_ok=True)
pid_file = os.path.join(d, "watchdog.pid")
if os.path.exists(pid_file):
    try:
        old_pid = int(open(pid_file).read().strip())
        os.kill(old_pid, signal.SIGTERM)
    except Exception:
        pass
script_path = os.path.join(d, "watchdog.py")
cfg_path = os.path.join(d, "watchdog.json")
hb_path = "${KUN_COLAB_HEARTBEAT_PATH}"
with open(script_path, "w", encoding="utf-8") as fh:
    fh.write(p["script"])
with open(hb_path, "w", encoding="utf-8") as fh:
    fh.write(str(time.time()))
now = time.time()
deadline = (now + float(p["maxRuntimeSeconds"])) if p["maxRuntimeSeconds"] else None
cfg = {
    "deadline_epoch": deadline,
    "idle_timeout_s": p["idleTimeoutSeconds"],
    "cancelled": False,
    "runtime_addr": os.environ.get("TBE_RUNTIME_ADDR", ""),
    "heartbeat": hb_path,
    "started": now,
}
with open(cfg_path, "w", encoding="utf-8") as fh:
    json.dump(cfg, fh)
proc = subprocess.Popen(
    [sys.executable, script_path, cfg_path],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
)
with open(pid_file, "w", encoding="utf-8") as fh:
    fh.write(str(proc.pid))
iso = datetime.datetime.fromtimestamp(deadline, datetime.timezone.utc).isoformat() if deadline else ""
print("KUN_WATCHDOG_OK:" + iso)
`
}

export function buildExtendVmWatchdogPython(addSeconds: number): string {
  return `import datetime, json, os, time
cfg_path = "${KUN_COLAB_WATCHDOG_DIR}/watchdog.json"
hb_path = "${KUN_COLAB_HEARTBEAT_PATH}"
now = time.time()
try:
    with open(hb_path, "w", encoding="utf-8") as fh:
        fh.write(str(now))
except Exception:
    pass
cfg = {}
if os.path.exists(cfg_path):
    try:
        with open(cfg_path, "r", encoding="utf-8") as fh:
            cfg = json.load(fh)
    except Exception:
        cfg = {}
base = cfg.get("deadline_epoch")
base = float(base) if isinstance(base, (int, float)) and base > now else now
deadline = base + ${Math.max(60, Math.round(addSeconds))}
cfg["deadline_epoch"] = deadline
cfg["cancelled"] = False
os.makedirs("${KUN_COLAB_WATCHDOG_DIR}", mode=0o700, exist_ok=True)
with open(cfg_path, "w", encoding="utf-8") as fh:
    json.dump(cfg, fh)
iso = datetime.datetime.fromtimestamp(deadline, datetime.timezone.utc).isoformat()
print("KUN_WATCHDOG_OK:" + iso)
`
}

export function parseWatchdogOutput(stdout: string): { ok: boolean; autoStopAt: string | null } {
  const line = stdout.split(/\r?\n/).find((item) => item.startsWith('KUN_WATCHDOG_OK:'))
  if (!line) return { ok: false, autoStopAt: null }
  const iso = line.slice('KUN_WATCHDOG_OK:'.length).trim()
  return { ok: true, autoStopAt: iso || null }
}

export type CostGuardEvaluation = {
  stopReason: ColabGuardStopReason | null
  warnings: ColabGuardWarningKind[]
}

/**
 * Pure app-side cost guard evaluation matching Colab Playground's `guard.rs`:
 * - Enforces runtime cap, per-session CU spend cap, and account CU balance floor.
 * - Never treats missing or stale (>5 min) account balance as zero or safe when a
 *   balance floor is configured; emits `balance_stale` instead.
 */
export function evaluateSessionCostGuard(params: {
  session: Pick<
    ColabSessionView,
    | 'elapsedSeconds'
    | 'consumedCu'
    | 'maxRuntimeHours'
    | 'maxSpendCu'
    | 'minBalanceCu'
  >
  connection?: Pick<ColabConnectionView, 'balanceCu' | 'burnRateCuPerHour' | 'updatedAt'> | null
  nowMs?: number
}): CostGuardEvaluation {
  const { session, connection } = params
  const nowMs = params.nowMs ?? Date.now()
  const warnings: ColabGuardWarningKind[] = []

  if (session.maxRuntimeHours > 0) {
    const limitSec = session.maxRuntimeHours * 3600
    const remainingSec = limitSec - session.elapsedSeconds
    if (remainingSec <= 0) {
      return { stopReason: 'max_runtime', warnings }
    }
    if (session.elapsedSeconds >= limitSec * GUARD_WARN_FRACTION || remainingSec <= 600) {
      warnings.push('runtime_nearing')
    }
  }

  if (session.maxSpendCu != null && session.maxSpendCu > 0) {
    if (session.consumedCu >= session.maxSpendCu) {
      return { stopReason: 'max_spend', warnings }
    }
    if (session.consumedCu >= session.maxSpendCu * GUARD_WARN_FRACTION) {
      warnings.push('spend_nearing')
    }
  }

  if (session.minBalanceCu != null && session.minBalanceCu > 0) {
    const updatedMs = connection?.updatedAt ? Date.parse(connection.updatedAt) : Number.NaN
    const isStale =
      !connection ||
      connection.balanceCu === null ||
      !Number.isFinite(updatedMs) ||
      nowMs - updatedMs > USAGE_STALE_AFTER_MS

    if (isStale) {
      warnings.push('balance_stale')
    } else {
      const dtHours = Math.max(0, (nowMs - updatedMs) / 3_600_000)
      const rate = Math.max(0, connection.burnRateCuPerHour ?? 0)
      const projectedBalance = connection.balanceCu! - rate * dtHours
      if (projectedBalance <= session.minBalanceCu) {
        return { stopReason: 'balance_floor', warnings }
      }
      if (session.minBalanceCu >= projectedBalance * GUARD_WARN_FRACTION) {
        warnings.push('balance_nearing')
      }
    }
  }

  return { stopReason: null, warnings }
}
