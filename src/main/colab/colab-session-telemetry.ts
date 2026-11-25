import type { ColabSessionView } from '../../shared/colab/colab-types'

export function buildRemoteShellRunnerPython(
  command: string,
  envVars: Record<string, string> | undefined,
  setupScript: string | undefined
): string {
  const payload = JSON.stringify({
    command,
    env: envVars ?? {},
    setup: setupScript?.trim() || ''
  })
  return `import json, os, subprocess, sys
cfg = json.loads(${JSON.stringify(payload)})
os.makedirs("/content", exist_ok=True)
os.chdir("/content")
env = dict(os.environ)
for k, v in cfg["env"].items():
    env[str(k)] = str(v)
env["PYTHONUNBUFFERED"] = "1"
if cfg["setup"]:
    rc = subprocess.call(cfg["setup"], shell=True, env=env)
    if rc != 0:
        sys.exit(rc)
proc = subprocess.Popen(
    cfg["command"],
    shell=True,
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
)
for line in proc.stdout:
    sys.stdout.write(line)
    sys.stdout.flush()
sys.exit(proc.wait())
`
}

export function buildRuntimeTelemetryProbePython(includeGpu: boolean): string {
  return `import shutil, subprocess
try:
    mt = ma = 0
    with open("/proc/meminfo") as f:
        for ln in f:
            if ln.startswith("MemTotal:"): mt = int(ln.split()[1])
            elif ln.startswith("MemAvailable:"): ma = int(ln.split()[1])
    du = shutil.disk_usage("/content")
    ram_used = max(0.0, (mt - ma) / 1048576.0) if mt else 0.0
    disk_pct = round(du.used * 100.0 / du.total) if du.total else 0
    print(f"KUN_SYS:{ram_used:.1f},{disk_pct}")
except Exception:
    pass
${
  includeGpu
    ? `try:
    out = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
        text=True,
        timeout=5,
    ).strip().splitlines()[0]
    print("KUN_GPU:" + out)
except Exception:
    pass`
    : ''
}
`
}

export function parseRuntimeTelemetryStdout(
  stdout: string,
  current: ColabSessionView
): Partial<ColabSessionView> {
  const lines = stdout.split(/\r?\n/)
  const patch: Partial<ColabSessionView> = {}
  const sysLine = lines.find((l) => l.startsWith('KUN_SYS:'))
  if (sysLine) {
    const [ramRaw, diskRaw] = sysLine.slice('KUN_SYS:'.length).split(',')
    const ramUsed = Number(ramRaw?.trim())
    const diskPct = Number(diskRaw?.trim())
    if (Number.isFinite(ramUsed)) patch.ramUsedGb = Number(ramUsed.toFixed(1))
    if (Number.isFinite(diskPct)) patch.diskUsedPct = Math.round(diskPct)
  }
  const gpuLine = lines.find((l) => l.startsWith('KUN_GPU:'))
  if (gpuLine) {
    const [utilRaw, usedMbRaw] = gpuLine.slice('KUN_GPU:'.length).split(',')
    const util = Number(utilRaw?.trim())
    const usedGb = Number(usedMbRaw?.trim()) / 1024
    if (Number.isFinite(util)) {
      patch.gpuUtilizationPct = Math.round(util)
      patch.vramUsedGb = Number.isFinite(usedGb) ? Number(usedGb.toFixed(1)) : current.vramUsedGb
      patch.gpuHistory = [...current.gpuHistory, util].slice(-24)
    }
  }
  return patch
}
