import type { AnalyticsInput } from '@shared/product-analytics'
let enabled = false
let epoch: string | undefined
export let captureSince = Infinity
export const PRODUCT_ANALYTICS_CHANGED = 'kun:product-analytics-changed'
export function setProductCapture(value: boolean, nextEpoch?: string) { enabled = value; epoch = nextEpoch; captureSince = value ? Date.now() : Infinity }
export const productCaptureEnabled = () => enabled && !window.kunGui?.isRemoteWeb
export const productCaptureEpoch = (): string | undefined => productCaptureEnabled() ? epoch : undefined
/** Native client only. Absence on older hosts/Remote web is a supported no-op. */
export function trackProduct(input: AnalyticsInput): void {
  if (!productCaptureEnabled() || !epoch) return
  try { void window.kunGui?.productAnalytics?.track(input, epoch).catch(() => {}) } catch { /* Optional reporting never interrupts the operation. */ }
}
export async function analyticsRunKey(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}
