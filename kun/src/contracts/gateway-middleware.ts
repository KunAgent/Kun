import { z } from 'zod'

/**
 * Gateway middleware: request and reply transforms applied to every external
 * agent's gateway traffic, whatever protocol it speaks. Built-ins are
 * declarative; a script is the user's own trusted code (like hooks), run with
 * per-call time limits and failing open.
 */
export const GATEWAY_MIDDLEWARE_TYPES = ['model-map', 'system-prompt', 'think-tags', 'script'] as const

export const GatewayMiddlewareSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1).max(64), enabled: z.boolean().default(true), type: z.literal('model-map'),
    /** Asked model → model the gateway serves instead; the client still sees the name it asked for. */
    mapping: z.record(z.string().min(1).max(512), z.string().min(1).max(512)).refine((value) => Object.keys(value).length <= 200) }).strict(),
  z.object({ id: z.string().min(1).max(64), enabled: z.boolean().default(true), type: z.literal('system-prompt'),
    text: z.string().min(1).max(20_000), position: z.enum(['prepend', 'append', 'replace']).default('append'),
    agents: z.array(z.string().min(1).max(64)).max(20).optional(), models: z.array(z.string().min(1).max(512)).max(50).optional() }).strict(),
  z.object({ id: z.string().min(1).max(64), enabled: z.boolean().default(true), type: z.literal('think-tags'),
    /** `reasoning` moves <think>…</think> text into reasoning; `strip` drops it. */
    mode: z.enum(['reasoning', 'strip']).default('reasoning') }).strict(),
  z.object({ id: z.string().min(1).max(64), enabled: z.boolean().default(true), type: z.literal('script'),
    /** A `.js` file inside the runtime's gateway-middleware folder. */
    file: z.string().min(1).max(256).regex(/^[A-Za-z0-9._-]+\.js$/),
    options: z.record(z.string(), z.unknown()).optional() }).strict()
])
export type GatewayMiddlewareConfig = z.infer<typeof GatewayMiddlewareSchema>

export type GatewayMiddlewareStats = {
  id: string
  type: GatewayMiddlewareConfig['type']
  enabled: boolean
  calls: number
  failures: number
  averageMicros: number
  lastError?: string
  loadError?: string
}
