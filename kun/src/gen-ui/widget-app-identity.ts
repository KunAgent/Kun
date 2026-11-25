import { createHash } from 'node:crypto'
import { widgetAppKey, type WidgetAppSource } from '../contracts/widget-app.js'

export const FIRST_WIDGET_APP_VERSION = '1.0.1'

export function widgetAppId(source: WidgetAppSource): string {
  const identity = JSON.stringify([source.threadId, widgetAppKey(source)])
  return 'kun-widget.app-' + createHash('sha256').update(identity).digest('hex').slice(0, 32)
}
