export type SettingsDraftController = {
  save: () => Promise<boolean>
  discard: () => void
}

export async function resolveSettingsDraftExit(
  choice: 'save' | 'discard' | 'keep',
  controller: SettingsDraftController | null
): Promise<'leave' | 'keep' | 'save-failed'> {
  if (choice === 'keep') return 'keep'
  if (choice === 'discard') {
    controller?.discard()
    return 'leave'
  }
  try {
    if (controller && !(await controller.save())) return 'save-failed'
  } catch {
    return 'save-failed'
  }
  return 'leave'
}
