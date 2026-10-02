import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

export const PAINT_PROBE_SOURCE = 'a8f9642ce10e4e5633adeef80b4fe5017f43b17b'

// This branch may change diagnostics, never the production being diagnosed.
export function assertFrozenSettingsProduction(root, execute = execFileSync) {
  const git = args => execute('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const trees = {}
  for (const directory of ['src', 'kun', 'packages']) {
    const expected = git(['rev-parse', `${PAINT_PROBE_SOURCE}:${directory}`])
    const actual = git(['rev-parse', `HEAD:${directory}`])
    assert.equal(actual, expected, `${directory} must match the frozen production source`)
    trees[directory] = { expected, actual }
  }
  git(['diff', '--exit-code', PAINT_PROBE_SOURCE, '--', 'src', 'kun', 'packages'])
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'src', 'kun', 'packages'])
    .split('\n').filter(file => file && !/^kun\/node_modules(?:\/|$)/.test(file))
  assert.deepEqual(untracked, [], 'No additional production files may be supplied to the probe')
  return { productionRevision: PAINT_PROBE_SOURCE, diagnosticRevision: git(['rev-parse', 'HEAD']), trees }
}

// Always preserve the initial frame. Delayed frames are additional evidence,
// not replacements selected for looking better. No styles or pixels are edited.
export async function captureSettingsPaintSequence({ snapshot, capture, wait, now, onFrame }) {
  const start = now()
  const frames = []
  for (const offsetMs of [0, 250, 1000]) {
    const remaining = offsetMs - (now() - start)
    if (remaining > 0) await wait(remaining)
    const before = await snapshot(`before-${offsetMs}ms`)
    const actualStartOffsetMs = now() - start
    const image = await capture(offsetMs)
    const after = await snapshot(`after-${offsetMs}ms`)
    const frame = { offsetMs, actualStartOffsetMs, actualEndOffsetMs: now() - start, before, image, after }
    frames.push(frame)
    await onFrame?.(frame)
  }
  return frames
}
