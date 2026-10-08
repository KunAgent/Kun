import { z } from 'zod'
import { KUN_AVATAR_CATALOG, KUN_AVATAR_DEFAULT_PARTS, getKunAvatarConflicts, kunAvatarScene } from './kun-avatar-catalog.js'

export const KunAvatarPartsSchema = z.object({
  color: z.enum(KUN_AVATAR_CATALOG.color.map((part) => part.id)),
  face: z.enum(KUN_AVATAR_CATALOG.face.map((part) => part.id)),
  headwear: z.enum(KUN_AVATAR_CATALOG.headwear.map((part) => part.id)).optional(),
  glasses: z.enum(KUN_AVATAR_CATALOG.glasses.map((part) => part.id)).optional(),
  outfit: z.enum(KUN_AVATAR_CATALOG.outfit.map((part) => part.id)).optional(),
  prop: z.enum(KUN_AVATAR_CATALOG.prop.map((part) => part.id)).optional(),
  bg: z.string().transform((value) => value.toLowerCase())
    .refine((value) => /^(#[a-f0-9]{6}|transparent)$/.test(value) || Boolean(kunAvatarScene(value)),
      'Expected a hex color, transparent, or a known scene')
    .default(KUN_AVATAR_DEFAULT_PARTS.bg)
}).strict().superRefine((parts, context) => {
  for (const { categories } of getKunAvatarConflicts(parts)) {
    context.addIssue({ code: 'custom', path: [categories[1]],
      message: `${categories[0]} and ${categories[1]} cannot be combined` })
  }
})

export const KunComposedAvatarReferenceSchema = z.object({
  kind: z.literal('composed'), version: z.literal(1), parts: KunAvatarPartsSchema
}).strict()
