import { z } from 'zod'

// Shared target and URL validators. They live next to the per-action schemas so
// every action shape is built from one set of refinements.
export const BrowserUseRef = z.string().min(16).max(512)
export const BrowserUseTabId = z.string().min(1).max(256)
export const BrowserUseExpectedTarget = z.object({
  sessionId: z.string().min(16).max(256),
  tabId: BrowserUseTabId,
  documentGeneration: z.number().int().nonnegative(),
  origin: z.string().url().max(2_048).refine((value) => {
    try {
      const parsed = new URL(value)
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.origin === value &&
        !parsed.username &&
        !parsed.password
      )
    } catch {
      return false
    }
  }, 'expected target origin must be an exact credential-free HTTP(S) origin'),
  sanitizedUrl: z.string().url().max(2_048).refine((value) => {
    try {
      const parsed = new URL(value)
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash
      )
    } catch {
      return false
    }
  }, 'expected target URL must be a credential-free URL without query or fragment'),
  role: z.string().max(128),
  name: z.string().max(512)
}).strict()
export type BrowserUseExpectedTarget = z.infer<typeof BrowserUseExpectedTarget>

export const BrowserUseTopLevelUrl = z.string().url().max(4096).refine((value) => {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}, 'browser use only accepts credential-free http or https top-level URLs')

const BrowserUseOpenAction = z.object({
  action: z.literal('open'),
  url: BrowserUseTopLevelUrl,
  newTab: z.boolean().optional()
}).strict()
const BrowserUseSnapshotAction = z.object({
  action: z.literal('snapshot')
}).strict()
const BrowserUseClickAction = z.object({
  action: z.literal('click'),
  ref: BrowserUseRef,
  expectedTarget: BrowserUseExpectedTarget
}).strict()
const BrowserUseTypeAction = z.object({
  action: z.literal('type'),
  ref: BrowserUseRef,
  expectedTarget: BrowserUseExpectedTarget,
  text: z.string().max(2000)
}).strict()
const BrowserUseSelectAction = z.object({
  action: z.literal('select'),
  ref: BrowserUseRef,
  expectedTarget: BrowserUseExpectedTarget,
  value: z.string().max(512)
}).strict()
const BrowserUsePressAction = z.object({
  action: z.literal('press'),
  ref: BrowserUseRef,
  expectedTarget: BrowserUseExpectedTarget,
  key: z.enum([
    'Enter',
    'Escape',
    'Tab',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'Backspace',
    'Delete',
    'Space'
  ])
}).strict()
const BrowserUseScrollAction = z.object({
  action: z.literal('scroll'),
  direction: z.enum(['up', 'down', 'left', 'right']),
  amount: z.number().int().min(1).max(2000).default(600)
}).strict()
const BrowserUseWaitAction = z.object({
  action: z.literal('wait'),
  milliseconds: z.number().int().min(100).max(5000).default(500)
}).strict()
const BrowserUseTabsAction = z.object({
  action: z.literal('tabs'),
  operation: z.enum(['list', 'switch', 'close']).default('list'),
  tabId: BrowserUseTabId.optional()
}).strict()

// The single actions a batch may carry, in catalog order. Batch-only entry
// points (close, screenshot, batch) are appended by the caller.
export const BROWSER_USE_BATCH_STEP_SCHEMAS = [
  BrowserUseOpenAction,
  BrowserUseSnapshotAction,
  BrowserUseClickAction,
  BrowserUseTypeAction,
  BrowserUseSelectAction,
  BrowserUsePressAction,
  BrowserUseScrollAction,
  BrowserUseWaitAction,
  BrowserUseTabsAction
] as const
