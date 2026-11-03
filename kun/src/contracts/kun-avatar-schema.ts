import { z } from 'zod'
import { KUN_AVATAR_CATALOG, KUN_AVATAR_DEFAULT_PARTS, getKunAvatarConflicts, kunAvatarScene } from './kun-avatar-catalog.js'

export const KunAvatarPartsSchema = z.object({
  color: z.string().refine(value => KUN_AVATAR_CATALOG.color.some(part => part.id === value), 'Unknown avatar part'),
  face: z.string().refine(value => KUN_AVATAR_CATALOG.face.some(part => part.id === value), 'Unknown avatar part'),
  headwear: z.string().refine(value => KUN_AVATAR_CATALOG.headwear.some(part => part.id === value), 'Unknown avatar part').optional(),
  glasses: z.string().refine(value => KUN_AVATAR_CATALOG.glasses.some(part => part.id === value), 'Unknown avatar part').optional(),
  outfit: z.string().refine(value => KUN_AVATAR_CATALOG.outfit.some(part => part.id === value), 'Unknown avatar part').optional(),
  prop: z.string().refine(value => KUN_AVATAR_CATALOG.prop.some(part => part.id === value), 'Unknown avatar part').optional(),
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
