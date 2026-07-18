import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  MulticamPanel,
  type MulticamPanelGroup,
  type MulticamPanelProps
} from '../src/webview/multicam-panel.js'

describe('multicam right-sidebar panel', () => {
  it('shows bounded groups, member and angle labels, coverage, sync evidence, and program fragments', () => {
    const html = renderToStaticMarkup(<MulticamPanel {...panelProps()} />)

    expect(html).toContain('role="tablist"')
    expect(html).toContain('Interview cameras')
    expect(html).toContain('Reference camera')
    expect(html).toContain('Wide')
    expect(html).toContain('Close camera')
    expect(html).toContain('Close')
    expect(html).toContain('Coverage</dt><dd>100%')
    expect(html).toContain('Sync: Verified; Confidence: 94%')
    expect(html).toContain('Angle: Wide')
    expect(html).toContain('Layout: Side by side')
    expect(html).toContain('Start frame')
    expect(html).toContain('End frame')
    expect(html).not.toMatch(/\/Users\/|\/tmp\/|media_[a-z0-9_]+/iu)
  })

  it('creates a group only from two available video sources with an explicit reference', async () => {
    const onCreate = vi.fn(async () => undefined)
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => { renderer = create(<MulticamPanel {...panelProps({ groups: [], onCreate })} />) })
      const createForm = renderer!.root.findAllByType('form')[0]!
      const name = labelledControl(renderer!.root, 'Group name')
      await act(async () => name.props.onChange({ target: { value: '  Studio cut  ' } }))

      for (const assetName of ['Wide.mp4', 'Close.mp4']) {
        const checkbox = labelledControl(renderer!.root, assetName)
        await act(async () => checkbox.props.onChange({ target: { checked: true } }))
      }
      const unavailable = labelledControl(renderer!.root, 'Offline.mp4')
      expect(unavailable.props.disabled).toBe(true)
      const reference = labelledControl(renderer!.root, 'Reference camera')
      await act(async () => reference.props.onChange({ target: { value: 'asset-wide' } }))
      await act(async () => {
        createForm.props.onSubmit({ preventDefault: vi.fn() })
        await flush()
      })

      expect(onCreate).toHaveBeenCalledWith({
        name: 'Studio cut',
        assetIds: ['asset-wide', 'asset-close'],
        referenceAssetId: 'asset-wide'
      })
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('emits explicit range, label, sync, switch, layout, preview, and merge requests', async () => {
    const onRenameLabels = vi.fn(async () => undefined)
    const onConfirmSync = vi.fn(async () => undefined)
    const onSwitch = vi.fn(async () => undefined)
    const onApplyLayout = vi.fn(async () => undefined)
    const onPreview = vi.fn(async () => undefined)
    const onMerge = vi.fn(async () => undefined)
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<MulticamPanel {...panelProps({
          onRenameLabels,
          onConfirmSync,
          onSwitch,
          onApplyLayout,
          onPreview,
          onMerge
        })} />)
      })

      const groupSummary = renderer!.root.find((node) => node.props.className === 'multicam-group-summary')
      const groupName = labelledControl(groupSummary, 'Group name')
      await act(async () => groupName.props.onChange({ target: { value: 'Interview final' } }))
      const groupForm = groupSummary.findByType('form')
      await submit(groupForm)
      expect(onRenameLabels).toHaveBeenLastCalledWith({
        groupId: 'group-one',
        groupName: 'Interview final'
      })

      const closeCard = renderer!.root.findAll((node) => node.props.className === 'multicam-member-card')[1]!
      const labelForm = closeCard.find((node) => node.props.className === 'multicam-member-editor').findByType('form')
      const labelInputs = labelForm.findAllByType('input')
      await act(async () => {
        labelInputs[0]!.props.onChange({ target: { value: 'Guest camera' } })
        labelInputs[1]!.props.onChange({ target: { value: 'Guest close' } })
      })
      await submit(labelForm)
      expect(onRenameLabels).toHaveBeenLastCalledWith({
        groupId: 'group-one',
        memberId: 'member-close',
        memberLabel: 'Guest camera',
        angleLabel: 'Guest close'
      })

      const syncForm = closeCard.find((node) => node.props.className === 'multicam-sync-editor').findByType('form')
      const syncInputs = syncForm.findAllByType('input')
      await act(async () => {
        syncInputs[0]!.props.onChange({ target: { value: '4' } })
        syncInputs[1]!.props.onChange({ target: { value: '0.88' } })
      })
      await submit(syncForm)
      expect(onConfirmSync).toHaveBeenCalledWith({
        groupId: 'group-one',
        memberId: 'member-close',
        offsetFrames: 4,
        status: 'verified',
        confidence: 0.88
      })

      await act(async () => {
        labelledControl(renderer!.root, 'Start frame').props.onChange({ target: { value: '30' } })
        labelledControl(renderer!.root, 'End frame').props.onChange({ target: { value: '90' } })
        labelledControl(renderer!.root, 'Incomplete coverage').props.onChange({ target: { value: 'clamp' } })
      })
      await click(buttonWithin(closeCard, 'Switch range to angle'))
      expect(onSwitch).toHaveBeenCalledWith({
        groupId: 'group-one',
        memberId: 'member-close',
        range: { startFrame: 30, endFrame: 90 },
        coveragePolicy: 'clamp'
      })

      await click(button(renderer!.root, 'Apply layout to range'))
      expect(onApplyLayout).toHaveBeenCalledWith({
        groupId: 'group-one',
        layoutId: 'layout-side-by-side',
        range: { startFrame: 30, endFrame: 90 },
        coveragePolicy: 'clamp'
      })
      await click(button(renderer!.root, 'Preview selected range'))
      expect(onPreview).toHaveBeenCalledWith({
        groupId: 'group-one',
        range: { startFrame: 30, endFrame: 90 },
        coveragePolicy: 'clamp'
      })
      await click(button(renderer!.root, 'Merge adjacent fragments'))
      expect(onMerge).toHaveBeenCalledWith('group-one')
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('supports keyboard group navigation and keeps one tab panel active', async () => {
    const alternate = { ...group(), id: 'group-two', name: 'Alternate cameras' }
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<MulticamPanel {...panelProps({ groups: [group(), alternate] })} />)
      })
      const tabs = renderer!.root.findAll((node) => node.props.role === 'tab')
      expect(tabs[0]!.props['aria-selected']).toBe(true)
      const preventDefault = vi.fn()
      await act(async () => tabs[0]!.props.onKeyDown({ key: 'ArrowRight', preventDefault }))
      const nextTabs = renderer!.root.findAll((node) => node.props.role === 'tab')
      expect(preventDefault).toHaveBeenCalled()
      expect(nextTabs[1]!.props['aria-selected']).toBe(true)
      expect(renderer!.root.findAll((node) => node.props.role === 'tabpanel')).toHaveLength(1)
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('surfaces callback failure without leaving the panel permanently busy', async () => {
    const onPreview = vi.fn(async () => { throw new Error('Preview requires complete coverage') })
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => { renderer = create(<MulticamPanel {...panelProps({ onPreview })} />) })
      await click(button(renderer!.root, 'Preview selected range'))
      expect(renderer!.root.findByProps({ role: 'alert' }).props.children).toBe('Preview requires complete coverage')
      expect(button(renderer!.root, 'Preview selected range').props.disabled).toBe(false)
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('keeps all document controls bounded at the 280 px sidebar contract', () => {
    const css = readFileSync(new URL('../src/webview/multicam-panel.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.multicam-panel\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/su)
    expect(css).toMatch(/\.multicam-group-tabs\s*\{[^}]*overflow-x:\s*auto;/su)
    expect(css).toMatch(/\.multicam-member-list\s*\{[^}]*max-height:\s*560px;[^}]*overflow:\s*auto;/su)
    expect(css).toMatch(/@media \(max-width: 360px\)[\s\S]*\.multicam-range,[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\);/u)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/u)
    expect(css).toMatch(/@media \(forced-colors: active\)/u)
  })
})

function panelProps(overrides: Partial<MulticamPanelProps> = {}): MulticamPanelProps {
  return {
    groups: [group()],
    assets: [
      { id: 'asset-wide', name: 'Wide.mp4', kind: 'video', available: true },
      { id: 'asset-close', name: 'Close.mp4', kind: 'video', available: true },
      { id: 'asset-offline', name: 'Offline.mp4', kind: 'video', available: false },
      { id: 'asset-audio', name: 'Recorder.wav', kind: 'audio', available: true }
    ],
    onCreate: async () => undefined,
    onRenameLabels: async () => undefined,
    onConfirmSync: async () => undefined,
    onSwitch: async () => undefined,
    onMerge: async () => undefined,
    onApplyLayout: async () => undefined,
    onPreview: async () => undefined,
    ...overrides
  }
}

function group(): MulticamPanelGroup {
  return {
    id: 'group-one',
    sequenceId: 'sequence-main',
    name: 'Interview cameras',
    durationFrames: 300,
    referenceMemberId: 'member-wide',
    members: [
      {
        id: 'member-wide',
        assetId: 'asset-wide',
        memberLabel: 'Reference camera',
        angleLabel: 'Wide',
        sync: { status: 'reference', offsetFrames: 0, confidence: 1 },
        coverage: [{ startFrame: 0, endFrame: 300 }]
      },
      {
        id: 'member-close',
        assetId: 'asset-close',
        memberLabel: 'Close camera',
        angleLabel: 'Close',
        sync: { status: 'verified', offsetFrames: 2, confidence: 0.94 },
        coverage: [
          { startFrame: 0, endFrame: 160 },
          { startFrame: 150, endFrame: 300 }
        ]
      }
    ],
    layouts: [{
      id: 'layout-side-by-side',
      label: 'Side by side',
      memberIds: ['member-wide', 'member-close']
    }],
    programFragments: [
      {
        id: 'fragment-wide',
        startFrame: 0,
        endFrame: 150,
        selection: { kind: 'angle', memberId: 'member-wide' }
      },
      {
        id: 'fragment-layout',
        startFrame: 150,
        endFrame: 300,
        selection: { kind: 'layout', layoutId: 'layout-side-by-side' }
      }
    ]
  }
}

function labelledControl(root: ReactTestInstance, label: string): ReactTestInstance {
  const candidate = root.findAllByType('label').find((node) => textOf(node).includes(label))
  if (!candidate) throw new Error(`Missing label: ${label}`)
  const control = candidate.findAll((node) => node.type === 'input' || node.type === 'select')[0]
  if (!control) throw new Error(`Missing control for label: ${label}`)
  return control
}

function button(root: ReactTestInstance, label: string): ReactTestInstance {
  return buttonWithin(root, label)
}

function buttonWithin(root: ReactTestInstance, label: string): ReactTestInstance {
  const candidate = root.findAllByType('button').find((node) => textOf(node) === label)
  if (!candidate) throw new Error(`Missing button: ${label}`)
  return candidate
}

async function click(target: ReactTestInstance): Promise<void> {
  await act(async () => {
    target.props.onClick()
    await flush()
  })
}

async function submit(form: ReactTestInstance): Promise<void> {
  await act(async () => {
    form.props.onSubmit({ preventDefault: vi.fn() })
    await flush()
  })
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textOf(child)).join('')
}
