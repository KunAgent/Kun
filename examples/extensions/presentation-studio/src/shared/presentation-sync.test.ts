import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decidePresentationChange,
  latestPresentationPath,
  presentationPathsFromWorkspaceEntries
} from './presentation-sync.js'

test('main Agent changes are followed when the sidebar has no deck or another deck', () => {
  assert.equal(decidePresentationChange({
    hasProject: false,
    activePath: '',
    currentRevision: 0,
    changePath: 'agent-deck.kun-ppt.html',
    changeRevision: 1,
    source: 'tool'
  }), 'follow-tool')
  assert.equal(decidePresentationChange({
    hasProject: true,
    activePath: 'old-deck.kun-ppt.html',
    currentRevision: 3,
    changePath: 'agent-deck.kun-ppt.html',
    changeRevision: 2,
    source: 'tool'
  }), 'follow-tool')
})

test('the current deck refreshes only for a newer revision', () => {
  assert.equal(decidePresentationChange({
    hasProject: true,
    activePath: 'agent-deck.kun-ppt.html',
    currentRevision: 2,
    changePath: 'agent-deck.kun-ppt.html',
    changeRevision: 3,
    source: 'tool'
  }), 'refresh-current')
  assert.equal(decidePresentationChange({
    hasProject: true,
    activePath: 'agent-deck.kun-ppt.html',
    currentRevision: 3,
    changePath: 'agent-deck.kun-ppt.html',
    changeRevision: 3,
    source: 'tool'
  }), 'ignore')
  assert.equal(decidePresentationChange({
    hasProject: false,
    activePath: '',
    currentRevision: 0,
    changePath: 'command-deck.kun-ppt.html',
    changeRevision: 1,
    source: 'command'
  }), 'ignore')
})

test('workspace discovery accepts root presentation files and selects the newest', () => {
  const paths = presentationPathsFromWorkspaceEntries([
    { name: 'first.kun-ppt.html', type: 'file' },
    { name: 'notes.md', type: 'file' },
    { name: '../outside.kun-ppt.html', type: 'file' },
    { name: 'nested', type: 'directory' }
  ])
  assert.deepEqual(paths, ['first.kun-ppt.html'])
  assert.equal(latestPresentationPath([
    { path: 'first.kun-ppt.html', modifiedAt: '2026-07-14T01:00:00.000Z' },
    { path: 'agent-deck.kun-ppt.html', modifiedAt: '2026-07-14T02:00:00.000Z' }
  ]), 'agent-deck.kun-ppt.html')
})
