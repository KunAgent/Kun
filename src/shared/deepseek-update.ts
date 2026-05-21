export type DeepseekPackageSource = 'bundled' | 'dev' | 'updated'

export type DeepseekUpdateInfo =
  | {
      ok: true
      managed: true
      currentVersion: string | null
      currentSource: DeepseekPackageSource
      latestVersion: string
      updateAvailable: boolean
      registryUrl: string
      tarballUrl: string
      integrity: string | null
    }
  | {
      ok: true
      managed: false
      reason: 'custom_binary'
      binaryPath: string
      updateAvailable: false
    }
  | {
      ok: false
      managed: boolean
      currentVersion: string | null
      message: string
    }

export type DeepseekUpdateInstallResult =
  | {
      ok: true
      version: string
      binaryPath: string
      restarted: boolean
      healthy: boolean
    }
  | {
      ok: false
      reason:
        | 'custom_binary'
        | 'check_failed'
        | 'up_to_date'
        | 'download_failed'
        | 'install_failed'
        | 'restart_failed'
      message: string
    }
