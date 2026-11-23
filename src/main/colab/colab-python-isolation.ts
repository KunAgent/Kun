import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Self-contained Python keyring backend injected via `PYTHON_KEYRING_BACKEND`.
 * Isolates `google-colab-cli` OAuth tokens per Kun connection using `filelock`
 * (already a direct dependency of `google-colab-cli`), completely bypassing the
 * shared OS keyring slot `("google-colab-cli", "oauth_token")`.
 */
const KUN_COLAB_KEYRING_PY = `import os
import tempfile
import filelock
from keyring.backend import KeyringBackend


class ConnectionKeyring(KeyringBackend):
    priority = 10

    def _cred_path(self) -> str:
        path = os.environ.get("KUN_COLAB_CRED_FILE", "").strip()
        if not path:
            raise RuntimeError("KUN_COLAB_CRED_FILE is not set")
        return path

    def get_password(self, service: str, username: str):
        path = self._cred_path()
        if not os.path.exists(path):
            return None
        lock = filelock.FileLock(path + ".lock", timeout=15)
        with lock:
            if not os.path.exists(path):
                return None
            with open(path, "r", encoding="utf-8") as handle:
                data = handle.read().strip()
                return data or None

    def set_password(self, service: str, username: str, password: str) -> None:
        path = self._cred_path()
        parent = os.path.dirname(path)
        os.makedirs(parent, mode=0o700, exist_ok=True)
        lock = filelock.FileLock(path + ".lock", timeout=15)
        with lock:
            fd, tmp_path = tempfile.mkstemp(prefix=".cred-", dir=parent)
            try:
                try:
                    os.chmod(tmp_path, 0o600)
                except OSError:
                    pass
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    handle.write(password)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(tmp_path, path)
            finally:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass

    def delete_password(self, service: str, username: str) -> None:
        path = self._cred_path()
        lock = filelock.FileLock(path + ".lock", timeout=15)
        with lock:
            if os.path.exists(path):
                os.remove(path)
`

export type IsolatedColabConnectionPaths = {
  homeDir: string
  colabConfigDir: string
  sessionsJsonPath: string
  settingsJsonPath: string
  bridgePyDir: string
  sshKeyPath: string
}

export class ColabPythonIsolation {
  constructor(
    private readonly colabRootDir: string,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  pathsForConnection(connectionId: string): IsolatedColabConnectionPaths {
    const homeDir = join(this.colabRootDir, 'connections', connectionId, 'home')
    const colabConfigDir = join(homeDir, '.config', 'colab-cli')
    return {
      homeDir,
      colabConfigDir,
      sessionsJsonPath: join(colabConfigDir, 'sessions.json'),
      settingsJsonPath: join(colabConfigDir, 'settings.json'),
      bridgePyDir: join(this.colabRootDir, 'bridge-py'),
      sshKeyPath: join(this.colabRootDir, 'ssh', 'id_ed25519')
    }
  }

  async ensureBridgeAssets(): Promise<{ bridgePyDir: string; sshKeyPath: string }> {
    const bridgePyDir = join(this.colabRootDir, 'bridge-py')
    await mkdir(bridgePyDir, { recursive: true, mode: 0o700 })
    const modulePath = join(bridgePyDir, 'kun_colab_keyring.py')
    await writeFile(modulePath, KUN_COLAB_KEYRING_PY, { mode: 0o600 })

    const sshDir = join(this.colabRootDir, 'ssh')
    await mkdir(sshDir, { recursive: true, mode: 0o700 })
    const sshKeyPath = join(sshDir, 'id_ed25519')
    if (!existsSync(sshKeyPath) || !existsSync(`${sshKeyPath}.pub`)) {
      try {
        await execFileAsync('ssh-keygen', [
          '-t',
          'ed25519',
          '-N',
          '',
          '-C',
          'kun-colab',
          '-f',
          sshKeyPath
        ])
        if (this.platform !== 'win32') {
          await chmod(sshKeyPath, 0o600).catch(() => undefined)
        }
      } catch {
        // ssh-keygen is optional unless the user invokes `colab ssh`.
      }
    }
    return { bridgePyDir, sshKeyPath }
  }

  async prepareConnectionEnvironment(
    connectionId: string,
    runtimeTokenFilePath: string
  ): Promise<{
    paths: IsolatedColabConnectionPaths
    env: Record<string, string>
  }> {
    await this.ensureBridgeAssets()
    const paths = this.pathsForConnection(connectionId)
    await mkdir(paths.colabConfigDir, { recursive: true, mode: 0o700 })
    if (!existsSync(paths.settingsJsonPath)) {
      await writeFile(
        paths.settingsJsonPath,
        JSON.stringify({ enable_update_check: false }, null, 2),
        { mode: 0o600 }
      )
    }

    const baseEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') baseEnv[key] = value
    }
    delete baseEnv.GOOGLE_APPLICATION_CREDENTIALS
    delete baseEnv.CLOUDSDK_CONFIG

    const existingPythonPath = baseEnv.PYTHONPATH?.trim()
    const pythonPath = existingPythonPath
      ? `${paths.bridgePyDir}${delimiter}${existingPythonPath}`
      : paths.bridgePyDir

    const env: Record<string, string> = {
      ...baseEnv,
      HOME: paths.homeDir,
      USERPROFILE: paths.homeDir,
      PYTHON_KEYRING_BACKEND: 'kun_colab_keyring.ConnectionKeyring',
      PYTHONPATH: pythonPath,
      KUN_COLAB_CRED_FILE: runtimeTokenFilePath,
      PYTHONUNBUFFERED: '1',
      PYTHONUTF8: '1'
    }
    return { paths, env }
  }
}
