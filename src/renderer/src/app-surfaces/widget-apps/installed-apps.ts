import { useEffect } from 'react'
import { create } from 'zustand'
import type { WidgetApp } from '../../../../../kun/src/contracts/widget-app'

export function widgetAppsApi() {
  return typeof window === 'undefined' || window.kunGui?.isRemoteWeb ? undefined : window.kunGui?.widgetApps
}

const useApps = create<{ apps: WidgetApp[] }>(() => ({ apps: [] }))
let loading: Promise<void> | undefined
export function refreshWidgetApps(): Promise<void> {
  const api = widgetAppsApi()
  if (!api) return Promise.resolve()
  if (!loading) loading = api.list().then(apps => { useApps.setState({ apps }) }).finally(() => { loading = undefined })
  return loading
}

/** All visible cards share a single catalog read and focus subscription. */
let subscribers = 0
const refresh = () => { void refreshWidgetApps().catch(() => undefined) }
export function useInstalledWidgetApps(): WidgetApp[] {
  useEffect(() => {
    if (++subscribers === 1) {
      refresh()
      window.addEventListener('focus', refresh)
      window.addEventListener('kun:extensions-changed', refresh)
    }
    return () => {
      if (--subscribers === 0) {
        window.removeEventListener('focus', refresh)
        window.removeEventListener('kun:extensions-changed', refresh)
      }
    }
  }, [])
  return useApps(state => state.apps)
}
