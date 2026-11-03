#!/usr/bin/env node
'use strict'

const { join } = require('node:path')
const {
  MANIFEST_FILE_NAME,
  formatIntegrityProblems,
  readPackagedRuntimeIntegrity,
  verifyPackagedRuntimeIntegrity
} = require('./packaged-runtime-integrity.cjs')

// Verifies an installed (or unpacked) payload against the manifest that
// after-pack wrote beside app.asar. Used by the Windows installer smoke test and
// available for local triage of a broken installation.
function parseArgs(argv) {
  const options = { mode: 'hash' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--resources') options.resources = argv[++index]
    else if (arg === '--mode') options.mode = argv[++index] === 'presence' ? 'presence' : 'hash'
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!options.resources) throw new Error('--resources <path> is required')
  return options
}

function verifyPackagedRuntimeIntegrityCli(argv) {
  const options = parseArgs(argv)
  const manifest = readPackagedRuntimeIntegrity(options.resources)
  if (!manifest) {
    throw new Error(
      `The packaged Kun runtime integrity manifest is missing: ${join(options.resources, MANIFEST_FILE_NAME)}`
    )
  }
  const result = verifyPackagedRuntimeIntegrity({
    resourcesDir: options.resources,
    manifest,
    mode: options.mode
  })
  if (!result.ok) {
    console.error(`[runtime-integrity] ${options.mode} verification failed:`)
    console.error(formatIntegrityProblems(result.problems))
    return 1
  }
  console.log(
    `[runtime-integrity] ${manifest.files.length} files and ${manifest.modules.length} packages verified ` +
      `(${options.mode}, build ${result.runtimeBuildId ?? 'unknown'}).`
  )
  return 0
}

if (require.main === module) {
  try {
    process.exitCode = verifyPackagedRuntimeIntegrityCli(process.argv.slice(2))
  } catch (error) {
    console.error(`[runtime-integrity] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

module.exports = { verifyPackagedRuntimeIntegrityCli }
