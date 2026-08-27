import type { ModelProviderProfileV1 } from './app-settings-types'

export type TimePricingBenefitKind = 'unit-price-discount' | 'quota-multiplier'
export type TimePricingState = 'off-peak' | 'standard' | 'unsupported'

type TimeWindow = {
  startMinute: number
  endMinute: number
  weekDays?: number[]
}

export type ModelTimePricingRule = {
  id: string
  benefitKind: TimePricingBenefitKind
  timeZone: string
  peakWindows: TimeWindow[]
  models: string[]
  sourceUrl: string
  verifiedAt: string
  description: string
  matchesProvider: (provider: ModelProviderProfileV1) => boolean
}

const zhipuCodingPlanModels = ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-4.7', 'glm-4.5-air']
const zaiCodingPlanModels = [...zhipuCodingPlanModels, 'glm-5']
const codingPlanPeak: TimeWindow[] = [{ startMinute: 14 * 60, endMinute: 18 * 60, weekDays: [1, 2, 3, 4, 5] }]

function officialDeepSeek(provider: ModelProviderProfileV1): boolean {
  if (provider.id !== 'deepseek') return false
  try {
    const url = new URL(provider.baseUrl || 'https://api.deepseek.com')
    return url.protocol === 'https:' && url.hostname === 'api.deepseek.com'
  } catch {
    return false
  }
}

function preset(provider: ModelProviderProfileV1, presetId: string): boolean {
  return provider.presetSource?.presetId === presetId && provider.presetSource.mode === 'api'
}

export const MODEL_TIME_PRICING_RULES: readonly ModelTimePricingRule[] = [
  {
    id: 'deepseek-off-peak-api',
    benefitKind: 'unit-price-discount',
    timeZone: 'Asia/Shanghai',
    peakWindows: [
      { startMinute: 9 * 60, endMinute: 12 * 60, weekDays: [1, 2, 3, 4, 5] },
      { startMinute: 14 * 60, endMinute: 18 * 60, weekDays: [1, 2, 3, 4, 5] }
    ],
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing/',
    verifiedAt: '2026-08-24',
    description: 'This official API model uses time-based token pricing.',
    matchesProvider: officialDeepSeek
  },
  {
    id: 'zhipu-coding-plan-off-peak',
    benefitKind: 'quota-multiplier',
    timeZone: 'Asia/Shanghai',
    peakWindows: codingPlanPeak,
    models: zhipuCodingPlanModels,
    sourceUrl: 'https://docs.bigmodel.cn/cn/coding-plan/overview',
    verifiedAt: '2026-08-18',
    description: 'This Coding Plan uses fewer credits outside peak hours.',
    matchesProvider: (provider) => preset(provider, 'zhipu-coding-plan')
  },
  {
    id: 'zai-coding-plan-off-peak',
    benefitKind: 'quota-multiplier',
    timeZone: 'Asia/Singapore',
    peakWindows: codingPlanPeak,
    models: zaiCodingPlanModels,
    sourceUrl: 'https://docs.z.ai/devpack/overview.md',
    verifiedAt: '2026-08-18',
    description: 'This Coding Plan uses fewer credits outside peak hours.',
    matchesProvider: (provider) => preset(provider, 'zai-coding-plan')
  }
]

function zonedMinuteAndWeekDay(iso: string, timeZone: string): { minute: number; weekDay: number } | null {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23'
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  const weekDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value('weekday'))
  return { minute: Number(value('hour')) * 60 + Number(value('minute')), weekDay }
}

export function resolveModelTimePricingRule(
  provider: ModelProviderProfileV1 | undefined,
  model: string
): ModelTimePricingRule | undefined {
  if (!provider) return undefined
  const normalizedModel = model.trim().toLowerCase()
  return MODEL_TIME_PRICING_RULES.find((rule) =>
    rule.matchesProvider(provider) && rule.models.includes(normalizedModel))
}

export function modelTimePricingState(
  provider: ModelProviderProfileV1 | undefined,
  model: string,
  iso: string
): { state: TimePricingState; rule?: ModelTimePricingRule } {
  const rule = resolveModelTimePricingRule(provider, model)
  if (!rule) return { state: 'unsupported' }
  const local = zonedMinuteAndWeekDay(iso, rule.timeZone)
  if (!local) return { state: 'unsupported' }
  const inPeak = rule.peakWindows.some((window) =>
    (!window.weekDays || window.weekDays.includes(local.weekDay)) &&
    (window.startMinute <= window.endMinute
      ? local.minute >= window.startMinute && local.minute < window.endMinute
      : local.minute >= window.startMinute || local.minute < window.endMinute))
  return { state: inPeak ? 'standard' : 'off-peak', rule }
}

export function timePricingScheduleLabel(rule: ModelTimePricingRule, locale: string): string {
  const chinese = locale.toLowerCase().startsWith('zh')
  const pad = (minute: number): string =>
    `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  const windows = rule.peakWindows.map((window) => `${pad(window.startMinute)}–${pad(window.endMinute)}`).join(chinese ? '、' : ', ')
  const hasWeekDays = rule.peakWindows.some((window) => Boolean(window.weekDays?.length))
  const recurring = hasWeekDays ? (chinese ? '周一至周五' : 'Monday–Friday') : (chinese ? '每天' : 'daily')
  const zone = rule.timeZone === 'Asia/Shanghai'
    ? (chinese ? '北京时间' : 'Beijing time')
    : rule.timeZone === 'Asia/Singapore'
      ? (chinese ? '新加坡时间' : 'Singapore time')
      : rule.timeZone
  if (chinese) {
    const remainder = rule.benefitKind === 'unit-price-discount' ? '其余为空闲时段。' : '其余为非高峰时段。'
    return `高峰期：${recurring} ${windows}（${zone}）；${remainder}`
  }
  const remainder = rule.benefitKind === 'unit-price-discount'
    ? 'All other times are off-peak.'
    : 'All other times are non-peak.'
  return `Peak hours: ${recurring} ${windows} (${zone}). ${remainder}`
}

export function timePricingBenefitLabel(kind: TimePricingBenefitKind): string {
  return kind === 'unit-price-discount' ? 'Low off-peak price' : 'Off-peak quota benefit'
}
