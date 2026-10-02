import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { geometryProblems, newGeometryProblems } from './settings-ui-smoke-geometry.mjs'

const control = (overrides = {}) => ({
  id: '1', semanticKey: 'appearance|Font scale|input|number||occurrence:1',
  tag: 'input', type: 'number', name: '', reached: { height: 36 },
  inside: true, hittable: true, focused: true, focusVisible: true, focusIndicator: true,
  ...overrides
})
const measurement = controls => ({ horizontalOverflow: false, scrollerOverflow: false, overlaps: [], controls })

test('problem identity survives numeric DOM ID changes and unrelated insertion', () => {
  const baseline = geometryProblems(measurement([control()]))
  const current = geometryProblems(measurement([
    control({ id: '0', semanticKey: 'navigation|select', name: 'Settings' }),
    control({ id: '2' })
  ]))
  assert.deepEqual(current, baseline)
  assert.match(current[0], /Font scale/)
})

test('baseline multiset rejects extra duplicates and genuinely new problems', () => {
  const old = { key: 'light-wide-125-general-landing', problem: 'same semantic control: clipped' }
  const added = { ...old, problem: 'new semantic control: missing accessible name' }
  assert.deepEqual(newGeometryProblems([old], [old, { ...old }, added]), [old, added])
  assert.deepEqual(newGeometryProblems([old, old], [old]), [])
  assert.deepEqual(newGeometryProblems([old], [{ ...old, key: 'dark-small-200-general-landing' }]),
    [{ ...old, key: 'dark-small-200-general-landing' }])
})

test('24px inline icon and switch exceptions do not hide undersized ordinary actions', () => {
  const valid = { name: 'Toggle', tag: 'button', reached: { height: 24 } }
  assert.deepEqual(geometryProblems(measurement([control({ ...valid, role: 'switch' })])), [])
  assert.deepEqual(geometryProblems(measurement([control({ ...valid, settingsSize: 'inline-icon' })])), [])
  assert.match(geometryProblems(measurement([control(valid)]))[0], /button height 24.00 < 28/)
})

test('workflow keeps both native OSes, source baseline and failure evidence', () => {
  const workflow = readFileSync(new URL('../.github/workflows/settings-ui-smoke.yml', import.meta.url), 'utf8')
  assert.match(workflow, /os: \[windows-latest, macos-latest\]/)
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/)
  assert.match(workflow, /9179a656e3b4236225cf098b00ccda932c55750d/)
  assert.match(workflow, /KUN_SETTINGS_SOURCE_ROOT: settings-ui-baseline/)
  assert.match(workflow, /KUN_SETTINGS_BASELINE_REPORT: dist\/settings-ui\/before\/report\.json/)
  assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact/)
})
