import { join } from 'node:path'
import { z } from 'zod'
import { AtomicJsonFile } from '../extensions/atomic-json.js'

const revisionSchema = z.object({ revision: z.number().int().nonnegative() }).strict()
/** Derived-data cursor, independent of Registry configuration CAS revisions. */
export function modelCatalogRevisionFile(dataDir: string) {
  return new AtomicJsonFile(join(dataDir, 'model-catalog', 'revision.json'), revisionSchema.parse, false)
}
