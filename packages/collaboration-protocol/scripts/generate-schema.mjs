import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { CollaborationProtocolSchema } from '../dist/schema.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, 'schema/collaboration-v1.json')
const schema = z.toJSONSchema(CollaborationProtocolSchema, {
  target: 'draft-2020-12',
  reused: 'ref'
})
const content = `${JSON.stringify(schema, null, 2)}\n`

if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => '')
  if (current !== content) {
    console.error('collaboration-v1.json is out of date; run npm run schema:generate --workspace @kun/collaboration-protocol')
    process.exitCode = 1
  }
} else {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
}
