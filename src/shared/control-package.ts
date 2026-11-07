export type ControlPackageStatus = {
  phase: string
  version?: string
  releaseId?: string
  candidateVersion?: string
  checkedAt?: number
  error?: string
}
export type ControlPackageApi = {
  status(): Promise<ControlPackageStatus>
  check(): Promise<ControlPackageStatus>
  install(): Promise<ControlPackageStatus>
  apply(): Promise<ControlPackageStatus>
}
export const CONTROL_PACKAGE_CHANNELS = {
  status: 'control-package:status', check: 'control-package:check', install: 'control-package:install', apply: 'control-package:apply'
} as const
