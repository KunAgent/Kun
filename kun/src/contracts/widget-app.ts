import { z } from 'zod'
import { GenUiWidgetIdSchema } from './gen-ui.js'

export const WidgetAppId = z.string().regex(/^kun-widget\.app-[a-f0-9]{32}$/)
export const WidgetAppKey = z.string().trim().min(1).max(120)
export const WidgetAppSource = z.object({
  threadId: z.string().min(1).max(256),
  widgetId: GenUiWidgetIdSchema,
  title: z.string().trim().min(1).max(120),
  appKey: WidgetAppKey.optional()
}).strict()
export type WidgetAppSource = z.infer<typeof WidgetAppSource>
export type WidgetApp = WidgetAppSource & {
  id: string
  version: string
  launcherTitle: string
  enabled: boolean
}

export function widgetAppKey(source: Pick<WidgetAppSource, 'title' | 'appKey'>): string {
  return (source.appKey ?? source.title).trim().normalize('NFKC').toLowerCase()
}
