import type { WidgetApp, WidgetAppSource } from '../../kun/src/contracts/widget-app'
import type { GenUiWidgetState } from '../../kun/src/contracts/gen-ui'

export const WIDGET_APP_CHANNELS = {
  list: 'widget-app:list', install: 'widget-app:install', open: 'widget-app:open',
  info: 'widget-app:info', save: 'widget-app:save', followUp: 'widget-app:follow-up',
  compose: 'widget-app:compose', composed: 'widget-app:composed'
} as const

export function widgetAppLaunchUrl(id: string): string {
  const url = 'kun://apps/' + id
  if (widgetAppFromArg(url) !== id) throw new Error('Invalid widget app ID')
  return url
}

export function widgetAppFromArg(raw: string): string | undefined {
  const match = /^kun:\/\/apps\/(kun-widget\.app-[0-9a-f]{32})$/.exec(raw.replace(/^"|"$/g, ''))
  return match?.[1]
}

export type WidgetAppFollowUp = { requestId: string; threadId: string; prompt: string; title: string; modelContent?: unknown }
export type WidgetAppsApi = {
  list(): Promise<WidgetApp[]>
  install(source: WidgetAppSource): Promise<WidgetApp | null>
  open(id: string): Promise<void>
  info(id: string): Promise<WidgetApp | null>
  save(id: string, widgetId: string, state: GenUiWidgetState): Promise<void>
  followUp(id: string, prompt: string): Promise<boolean>
  onCompose(listener: (request: WidgetAppFollowUp) => void): () => void
  composed(requestId: string, sent: boolean): void
}
