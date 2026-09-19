'use strict'

const { existsSync } = require('node:fs')
const { mkdir, symlink } = require('node:fs/promises')
const { join } = require('node:path')

const SANOTTS_RUNTIME_FILES = [
  'snt_g2p.js',
  'snt_g2p.wasm',
  'snt_g2p.data',
  'snt_voice.js',
  'snt_voice.wasm'
]
const SANOTTS_AMY_FILES = ['meta.json', 'front_f32.bin', 'dec_f32.bin']

function sanottsTestAssetsPresent(assetDir) {
  if (!assetDir) return false
  return SANOTTS_RUNTIME_FILES.every((file) => existsSync(join(assetDir, 'runtime', file)))
    && SANOTTS_AMY_FILES.every((file) => existsSync(join(assetDir, 'voices', 'amy', file)))
}

async function linkSanottsTestAssets(assetDir, userData) {
  const base = join(userData, 'models', 'speech', 'sanotts')
  const runtime = join(base, 'runtime')
  const voice = join(base, 'voices', 'amy')
  await mkdir(runtime, { recursive: true })
  await mkdir(voice, { recursive: true })
  for (const file of SANOTTS_RUNTIME_FILES) {
    await symlink(join(assetDir, 'runtime', file), join(runtime, file))
  }
  for (const file of SANOTTS_AMY_FILES) {
    await symlink(join(assetDir, 'voices', 'amy', file), join(voice, file))
  }
  return { base, runtime, voice, tracks: join(base, 'tracks') }
}

module.exports = {
  SANOTTS_RUNTIME_FILES,
  SANOTTS_AMY_FILES,
  sanottsTestAssetsPresent,
  linkSanottsTestAssets
}
