import { z } from 'zod'

export const COMPUTER_USE_BRIDGE_CONTRACT_VERSION = 2 as const
export const LEGACY_COMPUTER_USE_BRIDGE_CONTRACT_VERSION = 1 as const
export const KUN_COMPUTER_USE_BRIDGE_URL_ENV = 'KUN_COMPUTER_USE_BRIDGE_URL'
export const KUN_COMPUTER_USE_BRIDGE_TOKEN_ENV = 'KUN_COMPUTER_USE_BRIDGE_TOKEN'

const contractVersion = z.union([
  z.literal(COMPUTER_USE_BRIDGE_CONTRACT_VERSION),
  z.literal(LEGACY_COMPUTER_USE_BRIDGE_CONTRACT_VERSION)
])
const requestId = z.string().min(1).max(256)
const coordinate = z.number().finite()
const contextFields = {
  sessionId: z.string().min(1).max(128).optional(),
  frameId: z.string().min(1).max(128).optional()
}
const requestBase = { contractVersion, requestId }

export const AnyComputerUseBridgeRequest = z.discriminatedUnion('operation', [
  z.object({ ...requestBase, operation: z.literal('ready') }).strict(),
  z.object({ ...requestBase, operation: z.literal('capture'), ...contextFields }).strict(),
  z.object({ ...requestBase, operation: z.literal('screen_size'), ...contextFields }).strict(),
  z.object({ ...requestBase, operation: z.literal('cursor_position'), ...contextFields }).strict(),
  z.object({
    ...requestBase,
    operation: z.literal('move_to'),
    x: coordinate,
    y: coordinate,
    ...contextFields
  }).strict(),
  z.object({
    ...requestBase,
    operation: z.literal('click'),
    x: coordinate.optional(),
    y: coordinate.optional(),
    button: z.enum(['left', 'right', 'middle']),
    count: z.union([z.literal(1), z.literal(2)]),
    modifiers: z.array(z.string().max(64)).max(16),
    ...contextFields
  }).strict(),
  z.object({
    ...requestBase,
    operation: z.literal('drag'),
    x1: coordinate,
    y1: coordinate,
    x2: coordinate,
    y2: coordinate,
    ...contextFields
  }).strict(),
  z.object({
    ...requestBase,
    operation: z.literal('scroll'),
    x: coordinate.optional(),
    y: coordinate.optional(),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().finite().min(1).max(1_000),
    ...contextFields
  }).strict(),
  z.object({
    ...requestBase,
    operation: z.literal('type_text'),
    text: z.string().max(100_000),
    ...contextFields
  }).strict(),
  z.object({
    ...requestBase,
    operation: z.literal('press_hotkey'),
    key: z.string().min(1).max(256),
    ...contextFields
  }).strict(),
  z.object({
    ...requestBase,
    operation: z.literal('wait'),
    ms: z.number().finite().min(0).max(60_000),
    ...contextFields
  }).strict()
])

export const ComputerUseBridgeRequest = AnyComputerUseBridgeRequest.refine(
  (request) => request.contractVersion === COMPUTER_USE_BRIDGE_CONTRACT_VERSION,
  'computer-use bridge v2 request required'
)
export const LegacyComputerUseBridgeRequest = AnyComputerUseBridgeRequest.refine(
  (request) => request.contractVersion === LEGACY_COMPUTER_USE_BRIDGE_CONTRACT_VERSION,
  'computer-use bridge v1 request required'
)

export type AnyComputerUseBridgeRequest = z.infer<typeof AnyComputerUseBridgeRequest>
export type ComputerUseBridgeRequest = AnyComputerUseBridgeRequest & {
  contractVersion: typeof COMPUTER_USE_BRIDGE_CONTRACT_VERSION
}
export type ComputerUseBridgeRequestInput =
  ComputerUseBridgeRequest extends infer Request
    ? Request extends { contractVersion: number; requestId: string }
      ? Omit<Request, 'contractVersion' | 'requestId'>
      : never
    : never

const responseBase = { requestId, result: z.unknown() }
export const ComputerUseBridgeResponse = z.object({
  contractVersion: z.literal(COMPUTER_USE_BRIDGE_CONTRACT_VERSION),
  ...responseBase
}).strict()
export const LegacyComputerUseBridgeResponse = z.object({
  contractVersion: z.literal(LEGACY_COMPUTER_USE_BRIDGE_CONTRACT_VERSION),
  ...responseBase
}).strict()
export const AnyComputerUseBridgeResponse = z.union([
  ComputerUseBridgeResponse,
  LegacyComputerUseBridgeResponse
])

export type ComputerUseBridgeResponse = z.infer<typeof ComputerUseBridgeResponse>
