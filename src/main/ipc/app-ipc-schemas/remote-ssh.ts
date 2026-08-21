import { z } from 'zod'
import {
  REMOTE_SSH_MAX_HOSTNAME_LENGTH,
  REMOTE_SSH_MAX_LABEL_LENGTH,
  REMOTE_SSH_MAX_PATH_LENGTH,
  REMOTE_SSH_MAX_SESSION_ID_LENGTH,
  REMOTE_SSH_MAX_USERNAME_LENGTH,
  REMOTE_SSH_MAX_WRITE_BYTES
} from '../../../shared/remote-ssh'
import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS
} from '../../../shared/terminal'

const id = z.string().trim().min(1).max(REMOTE_SSH_MAX_SESSION_ID_LENGTH)
const hostname = z.string().trim().min(1).max(REMOTE_SSH_MAX_HOSTNAME_LENGTH)
  .refine((value) => !/[\s/@\\]/.test(value), 'Invalid SSH hostname')

export const remoteSshAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('agent') }).strict(),
  z.object({
    type: z.literal('identityFile'),
    identityFile: z.string().trim().min(1).max(REMOTE_SSH_MAX_PATH_LENGTH)
  }).strict()
])

export const remoteSshHostInputSchema = z.object({
  label: z.string().trim().min(1).max(REMOTE_SSH_MAX_LABEL_LENGTH),
  hostname,
  port: z.number().int().min(1).max(65_535).optional(),
  username: z.string().trim().min(1).max(REMOTE_SSH_MAX_USERNAME_LENGTH),
  auth: remoteSshAuthSchema
}).strict()

export const remoteSshHostIdSchema = id
export const remoteSshHostUpdateSchema = z.object({
  id,
  host: remoteSshHostInputSchema
}).strict()
export const remoteSshHostKeyConfirmationSchema = z.object({
  hostId: id,
  fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}=?$/),
  key: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(32_768)
}).strict()

export const remoteSshTerminalCreateSchema = z.object({
  sessionId: id,
  hostId: id,
  cols: z.number().int().min(1).max(TERMINAL_MAX_COLS).default(TERMINAL_DEFAULT_COLS),
  rows: z.number().int().min(1).max(TERMINAL_MAX_ROWS).default(TERMINAL_DEFAULT_ROWS)
}).strict()
export const remoteSshTerminalWriteSchema = z.object({
  sessionId: id,
  data: z.string().min(1).max(REMOTE_SSH_MAX_WRITE_BYTES)
}).strict()
export const remoteSshTerminalResizeSchema = z.object({
  sessionId: id,
  cols: z.number().int().min(1).max(TERMINAL_MAX_COLS),
  rows: z.number().int().min(1).max(TERMINAL_MAX_ROWS)
}).strict()
