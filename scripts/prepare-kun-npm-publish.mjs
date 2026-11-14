#!/usr/bin/env node
import assert from 'node:assert/strict'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { preparePublishPlan } from './lib/kun-npm-publish-plan.mjs'
import { executePublication } from './lib/kun-npm-publisher.mjs'

export function parsePublishArguments(argv) {
  const options = { execute: false, 'auth-mode': 'oidc' }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--execute') { options.execute = true; continue }
    assert(['--candidate', '--gate-a', '--receipts', '--audit', '--output', '--confirm', '--auth-mode'].includes(key),
      'Unknown argument: ' + key)
    const value = argv[++i]
    assert(value && !value.startsWith('--'), 'Missing argument: ' + key)
    assert(!Object.hasOwn(options, key.slice(2)) || key === '--auth-mode', 'Duplicate argument: ' + key)
    options[key.slice(2)] = ['--confirm', '--auth-mode'].includes(key) ? value : resolve(value)
  }
  for (const name of ['candidate', 'gate-a', 'receipts', 'output']) assert(options[name], 'Missing --' + name)
  if (options.execute) assert(options.confirm, 'Publication requires --confirm PLAN_ID')
  return options
}

export async function runPublishPreparation(options) {
  await mkdir(dirname(options.output), { recursive: true })
  await writeFile(options.output, JSON.stringify({ kind: 'kun-npm-publish-plan', prepared: false,
    publishable: false, published: false, distTagsChanged: false, state: 'running' }) + '\n')
  try {
    const context = { directory: options.candidate, gateA: options['gate-a'], receipts: options.receipts,
      audit: options.audit ? JSON.parse(await readFile(options.audit, 'utf8')) : null,
      policy: JSON.parse(await readFile('kun/npm/publish.json', 'utf8')),
      release: JSON.parse(await readFile('kun/npm/release.json', 'utf8')) }
    const result = options.execute
      ? await executePublication(context, { confirm: options.confirm, authMode: options['auth-mode'] })
      : await preparePublishPlan(context)
    await writeFile(options.output, JSON.stringify(result, null, 2) + '\n')
    if (process.env.GITHUB_OUTPUT && !options.execute) await appendFile(process.env.GITHUB_OUTPUT,
      'publishable=' + (result.publishable && context.policy.trustedPublisherConfigured ? 'true' : 'false') +
      '\nplan_id=' + result.planId + '\n')
    return result
  } catch (error) {
    await writeFile(options.output, JSON.stringify({ schemaVersion: 1, kind: 'kun-npm-publish-plan', prepared: false,
      publishable: false, published: false, distTagsChanged: false, state: 'failed-preflight', error: error.message }, null, 2) + '\n')
    throw error
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await runPublishPreparation(parsePublishArguments(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
  if (result.success === false) process.exitCode = 1
}
