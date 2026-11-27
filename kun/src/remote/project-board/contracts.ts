import { z } from 'zod'
import {
  PROJECT_BOARD_CATEGORIES,
  PROJECT_BOARD_PRIORITIES,
  PROJECT_BOARD_STATUSES
} from '@kun/remote-protocol'

const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const BoardRevision = z.string().regex(/^board-v1:(0|[1-9][0-9]*)$/)
const CardId = z.string().min(8).max(512)
const Status = z.enum(PROJECT_BOARD_STATUSES)
const Category = z.enum(PROJECT_BOARD_CATEGORIES)
const Priority = z.enum(PROJECT_BOARD_PRIORITIES).nullable()

export const ProjectBoardParamSchemas = {
  'project.board.get': z.object({
    projectId: Id,
    includeArchived: z.boolean().optional(),
    cursor: z.string().min(1).max(2048).optional()
  }).strict(),
  'project.board.summary': z.object({
    projectId: Id
  }).strict(),
  'project.board.create': z.object({
    projectId: Id,
    expectedRevision: BoardRevision,
    title: z.string().trim().min(1).max(300),
    description: z.string().max(2000).optional(),
    status: Status,
    category: Category.optional(),
    priority: Priority.optional()
  }).strict(),
  'project.board.update': z.object({
    projectId: Id,
    cardId: CardId,
    expectedRevision: BoardRevision,
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().max(2000).optional(),
    status: Status.optional(),
    category: Category.nullable().optional(),
    priority: Priority.optional(),
    archived: z.boolean().optional()
  }).strict().refine((value) =>
    [value.title, value.description, value.status, value.category, value.priority, value.archived]
      .some((field) => field !== undefined)
  ),
  'project.board.move': z.object({
    projectId: Id,
    expectedRevision: BoardRevision,
    cardIds: z.array(CardId).min(1).max(500),
    fromStatus: Status,
    status: Status
  }).strict(),
  'project.board.delete': z.object({
    projectId: Id,
    cardId: CardId,
    expectedRevision: BoardRevision
  }).strict()
} as const
