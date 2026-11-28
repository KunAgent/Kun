import { z } from 'zod'
import { DAILY_NOTES_QUADRANTS } from '@kun/remote-protocol'

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(value + 'T12:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
})
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const DailyRevision = z.string().regex(/^daily-v1:[a-f0-9]{64}$/)
const Quadrant = z.union([
  z.literal(DAILY_NOTES_QUADRANTS[0]),
  z.literal(DAILY_NOTES_QUADRANTS[1]),
  z.literal(DAILY_NOTES_QUADRANTS[2]),
  z.literal(DAILY_NOTES_QUADRANTS[3])
])
const LinkSpec = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.string().min(7).max(512).refine((url) => url.startsWith('kun://') && !/\s/.test(url))
}).strict()
const Notes = z.array(
  z.string().max(1000).refine((line) => !line.includes('\n') && !line.includes('\r'))
).max(50).refine((lines) => lines.reduce((sum, line) => sum + line.length, 0) <= 8000)

export const DailyNotesParamSchemas = {
  'daily.notes.list': z.object({
    limitDays: z.number().int().min(1).max(60).optional(),
    month: Month.optional()
  }).strict(),
  'daily.notes.get': z.object({
    day: Day
  }).strict(),
  'daily.notes.create': z.object({
    day: Day,
    title: z.string().trim().min(1).max(500),
    expectedRevision: DailyRevision.optional(),
    notes: Notes.optional(),
    quadrant: Quadrant.nullable().optional(),
    link: LinkSpec.nullable().optional()
  }).strict(),
  'daily.notes.update': z.object({
    day: Day,
    line: z.number().int().min(0).max(100000),
    expectedRevision: DailyRevision,
    title: z.string().trim().min(1).max(500).optional(),
    notes: Notes.optional(),
    done: z.boolean().optional(),
    quadrant: Quadrant.nullable().optional(),
    link: LinkSpec.nullable().optional(),
    moveToDay: Day.optional()
  }).strict().refine((value) =>
    [value.title, value.notes, value.done, value.quadrant, value.link, value.moveToDay]
      .some((field) => field !== undefined) &&
    (value.moveToDay === undefined || value.moveToDay !== value.day)
  ),
  'daily.notes.delete': z.object({
    day: Day,
    line: z.number().int().min(0).max(100000),
    expectedRevision: DailyRevision
  }).strict(),
  'daily.notes.rollover': z.object({
    fromDay: Day,
    toDay: Day,
    expectedFromRevision: DailyRevision.optional()
  }).strict().refine((value) => value.fromDay !== value.toDay)
} as const
