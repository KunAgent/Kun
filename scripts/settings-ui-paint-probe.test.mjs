import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { assertFrozenSettingsProduction, captureSettingsPaintSequence, PAINT_PROBE_SOURCE } from './settings-ui-paint-probe.mjs'

test('paint sequence retains initial and both delayed frames with bracketing snapshots', async () => {
  let clock = 0
  const events = [], preserved = []
  const frames = await captureSettingsPaintSequence({
    now: () => clock,
    wait: async delay => { events.push(['wait', delay]); clock += delay },
    snapshot: async label => { events.push(['snapshot', label]); return { label, time: clock } },
    capture: async offset => { events.push(['capture', offset]); clock += 20; return { file: `${offset}.png` } },
    onFrame: frame => preserved.push(frame)
  })
  assert.deepEqual(frames.map(frame => frame.offsetMs), [0, 250, 1000])
  assert.deepEqual(frames.map(frame => frame.actualStartOffsetMs), [0, 250, 1000])
  assert.deepEqual(events.filter(event => event[0] === 'wait'), [['wait', 230], ['wait', 730]])
  assert.equal(frames[0].before.label, 'before-0ms')
  assert.equal(frames[0].after.label, 'after-0ms')
  assert.deepEqual(preserved, frames)
})

test('failed capture propagates and never silently replaces an anomalous initial frame', async () => {
  const offsets = []
  await assert.rejects(captureSettingsPaintSequence({ now: () => 0, wait: async () => {},
    snapshot: async () => ({}), capture: async offset => { offsets.push(offset); throw Error('capture failed') }
  }), /capture failed/)
  assert.deepEqual(offsets, [0])
})

test('frozen production rejects changed trees, dirty source and extra source files', () => {
  const execute = (_command, args) => {
    if (args[0] === 'rev-parse') return args[1] === 'HEAD' ? 'diagnostic-head' : args[1].split(':')[1]
    return ''
  }
  assert.equal(assertFrozenSettingsProduction('/repo', execute).productionRevision, PAINT_PROBE_SOURCE)
  assert.throws(() => assertFrozenSettingsProduction('/repo', (command, args) =>
    args[1] === 'HEAD:src' ? 'changed' : execute(command, args)), /src must match/)
  assert.throws(() => assertFrozenSettingsProduction('/repo', (command, args) => {
    if (args[0] === 'diff') throw Error('dirty source')
    return execute(command, args)
  }), /dirty source/)
  assert.throws(() => assertFrozenSettingsProduction('/repo', (command, args) =>
    args[0] === 'ls-files' ? 'src/extra.ts' : execute(command, args)), /additional production files/)
})

test('probe workflow is push-only on its exact branch, native Mac, pinned source, all evidence', () => {
  const workflow = readFileSync(new URL('../.github/workflows/settings-paint-probe.yml', import.meta.url), 'utf8')
  assert.match(workflow, /branches: \['codex\/settings-paint-probe'\]/)
  assert.doesNotMatch(workflow, /pull_request:|workflow_dispatch:|windows-latest/)
  assert.match(workflow, /runs-on: macos-latest/)
  assert.match(workflow, /assertFrozenSettingsProduction/)
  assert.match(workflow, /--paint-probe/)
  assert.match(workflow, /settings-ui-paint-probe-dom\.test\.mjs/)
  assert.match(workflow, /if: always\(\)[\s\S]+actions\/upload-artifact/)
  assert.match(workflow, /github\.run_attempt/)
  const smoke = readFileSync(new URL('./smoke-settings-ui.mjs', import.meta.url), 'utf8')
  assert.match(smoke, /paintProbe \? configurations\.filter\(config => config\.name === 'small' && config\.zoom === 2\)/)
  assert.match(smoke, /geometry-passed-paint-unclassified/)
  assert.match(smoke, /if \(paintProbe\) await openCategory\('general'\)/)
  assert.match(smoke, /report\.paintProbes\?\.length, 8/)
  assert.match(smoke, /label === 'before-0ms'[\s\S]*existingDetail: detail/)
  assert.match(smoke, /assert\.deepEqual\(report\.requiredPolishFindings, \[\]/)
  assert.match(smoke, /await measureSettings\(page, cdp\)/)
  assert.match(smoke, /await window\.webContents\.capturePage\(\)/)
})
