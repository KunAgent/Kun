#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toJSONSchema } from 'zod'
import {
  ExtensionManifestSchema,
  MANIFEST_CONTRIBUTION_PERMISSION_REQUIREMENTS
} from '../dist/manifest.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(packageRoot, 'schema/kun-extension.schema.json')
const schema = toJSONSchema(ExtensionManifestSchema, {
  io: 'input',
  target: 'draft-2020-12',
  unrepresentable: 'throw',
  reused: 'ref'
})
schema.$id = 'https://kun.dev/schemas/extensions/manifest/v1.json'
schema.title = 'Kun Extension Manifest v1'
schema.description = 'Canonical schema for kun-extension.json'
schema.allOf = [
  permissionCondition({ browser: true }, 'webview'),
  ...Object.entries(MANIFEST_CONTRIBUTION_PERMISSION_REQUIREMENTS).flatMap(
    ([contribution, permissions]) =>
      permissions.map((permission) => permissionCondition({ contribution }, permission))
  )
]
const output = `${JSON.stringify(schema, null, 2)}\n`

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '')
  if (current.replace(/\r\n/gu, '\n') !== output) {
    console.error('EXT_SCHEMA_STALE: schema/kun-extension.schema.json is not generated from ExtensionManifestSchema')
    process.exitCode = 1
  }
} else {
  await writeFile(outputPath, output, 'utf8')
}

function permissionCondition(condition, permission) {
  const entryCondition = condition.browser
    ? { required: ['browser'] }
    : {
        required: ['contributes'],
        properties: {
          contributes: {
            required: [condition.contribution],
            properties: { [condition.contribution]: { minItems: 1 } }
          }
        }
      }
  return {
    if: entryCondition,
    then: {
      required: ['permissions'],
      properties: { permissions: { contains: { const: permission } } }
    }
  }
}
