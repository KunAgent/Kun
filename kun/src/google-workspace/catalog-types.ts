/* eslint-disable no-control-regex -- These schemas explicitly reject unsafe C0/C1 input characters. */
import { z } from 'zod'

export type GoogleWorkspaceRisk = 'read' | 'draft' | 'write' | 'send' | 'destructive'
export type GoogleWorkspaceServiceName = 'gmail' | 'calendar' | 'drive'
export type GoogleWorkspaceMethod = {
  method: string
  description: string
  service: GoogleWorkspaceServiceName
  risk: GoogleWorkspaceRisk
  scopes: readonly string[]
  params: z.ZodType<Record<string, unknown>>
  body?: z.ZodType<Record<string, unknown>>
  command?: readonly string[]
  responseFormat?: 'json' | 'media'
  transform?: (params: Record<string, unknown>, body?: Record<string, unknown>) => {
    params: Record<string, unknown>
    body?: Record<string, unknown>
  }
}

export const id = z.string().min(1).max(256).regex(/^[a-zA-Z0-9_-]+$/)
export const pageToken = z.string().min(1).max(2048).regex(/^[^\x00-\x1f\x7f-\x9f]+$/)
export const query = z.string().min(1).max(2048).regex(/^[^\x00-\x1f\x7f-\x9f]+$/)
export const email = z.string().email().max(254).regex(/^[^\s<>\r\n]+$/)
export const emptyParams = z.object({}).strict()
export const me = { userId: z.literal('me').default('me') }
export const gmailId = { ...me, id }
export const timestamp = z.iso.datetime({ offset: true })
export const headerText = z.string().min(1).max(512).regex(/^[^\x00-\x1f\x7f-\x9f]+$/)
export const textBody = z.string().max(16_384).refine((value) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value), 'Unsupported control character')
export const scopes = {
  gmailRead: ['https://www.googleapis.com/auth/gmail.readonly'],
  gmailModify: ['https://www.googleapis.com/auth/gmail.modify'],
  gmailCompose: ['https://www.googleapis.com/auth/gmail.compose'],
  gmailSend: ['https://www.googleapis.com/auth/gmail.send'],
  calendarRead: ['https://www.googleapis.com/auth/calendar.events.readonly'],
  calendarWrite: ['https://www.googleapis.com/auth/calendar.events'],
  driveRead: ['https://www.googleapis.com/auth/drive.readonly']
} as const
