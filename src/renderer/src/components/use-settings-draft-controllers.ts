import { useCallback, useRef } from 'react'
import type { SettingsDraftController } from './settings-draft-navigation'

/** Each settings object keeps its own draft and can be resolved independently. */
export function useSettingsDraftControllers(): {
  register: (key: string, controller: SettingsDraftController | null) => void
  hasPending: () => boolean
  current: () => SettingsDraftController | null
} {
  const controllersRef = useRef(new Map<string, SettingsDraftController>())
  const register = useCallback((key: string, controller: SettingsDraftController | null): void => {
    if (controller) controllersRef.current.set(key, controller)
    else controllersRef.current.delete(key)
  }, [])
  const hasPending = useCallback((): boolean => controllersRef.current.size > 0, [])
  const current = useCallback((): SettingsDraftController | null => {
    const controllers = [...controllersRef.current.values()]
    if (controllers.length === 0) return null
    return {
      save: async () => {
        for (const controller of controllers) {
          if (!(await controller.save())) return false
        }
        return true
      },
      discard: () => controllers.forEach((controller) => controller.discard())
    }
  }, [])
  return { register, hasPending, current }
}
