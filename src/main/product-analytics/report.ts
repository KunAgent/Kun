import type { IpcMainInvokeEvent } from 'electron'
import type { AnalyticsInput } from '../../shared/product-analytics'
import { isRemoteClientSender } from '../remote/remote-sender'
let sink: { capture(): string | null; track(event: AnalyticsInput, epoch: string): Promise<void> } | undefined
export function setDesktopAnalyticsSink(value: typeof sink) { sink = value }
/** Bind to consent/identity at operation start; never capture request arguments. */
export function captureDesktopAnalytics(event: IpcMainInvokeEvent): (input: AnalyticsInput) => void {
  const epoch = !isRemoteClientSender(event.sender) ? sink?.capture() : null
  return input => { if (epoch) void sink?.track(input, epoch).catch(() => {}) }
}
