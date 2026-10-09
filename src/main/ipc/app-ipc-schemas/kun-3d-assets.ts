import { z } from 'zod'
import { KUN_3D_ASSET_KEY_MAX_LENGTH } from '../../../shared/kun-3d-assets'

export const kun3dAssetReadPayloadSchema = z
  .object({ key: z.string().min(1).max(KUN_3D_ASSET_KEY_MAX_LENGTH) })
  .strict()
