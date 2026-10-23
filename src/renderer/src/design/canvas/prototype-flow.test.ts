import { describe, expect, it } from 'vitest'
import { createEmptyDocument, createHtmlFrameShape } from './canvas-types'
import { computePrototypeFlowEdges } from './prototype-flow'
import type { DesignArtifact } from '../design-types'

const createdAt = '2026-06-29T00:00:00.000Z'

function artifact(id: string, title: string, extra: Partial<DesignArtifact> = {}): DesignArtifact {
  const relativePath = `.kun-design/doc/${id}/v1.html`
  return {
    id,
    kind: 'html',
    title,
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${id}-v1`, relativePath, createdAt, summary: '' }],
    ...extra
  }
}

describe('computePrototypeFlowEdges', () => {
  it('lifts top lanes clear of the board label row', () => {
    const doc = createEmptyDocument()
    const homeFrame = createHtmlFrameShape('Home', 0, 0, 'home', 'desktop')
    const signupFrame = createHtmlFrameShape('Signup', 1500, 0, 'signup', 'desktop')
    doc.objects[homeFrame.id] = { ...homeFrame, parentId: doc.rootId }
    doc.objects[signupFrame.id] = { ...signupFrame, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [homeFrame.id, signupFrame.id] }
    const artifacts = [artifact('home', 'Home'), artifact('signup', 'Signup')]

    const plain = computePrototypeFlowEdges(artifacts, doc.objects)
    const cleared = computePrototypeFlowEdges(artifacts, doc.objects, { topClearance: 400 })
    const forward = (edges: typeof plain) => edges.find((edge) => edge.sourceArtifactId === 'home')
    const back = (edges: typeof plain) => edges.find((edge) => edge.sourceArtifactId === 'signup')
    expect(forward(cleared)?.controlY).toBe((forward(plain)?.controlY ?? 0) - 400)
    expect(back(cleared)?.controlY).toBe(back(plain)?.controlY)
  })

  it('connects visible HTML frames from persisted prototype links', () => {
    const doc = createEmptyDocument()
    const homeFrame = createHtmlFrameShape('Home', 0, 0, 'home', 'desktop')
    const signupFrame = createHtmlFrameShape('Signup', 1500, 0, 'signup', 'desktop')
    doc.objects[homeFrame.id] = { ...homeFrame, parentId: doc.rootId }
    doc.objects[signupFrame.id] = { ...signupFrame, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [homeFrame.id, signupFrame.id] }

    const edges = computePrototypeFlowEdges(
      [
        artifact('home', 'Home', {
          prototypeLinks: [
            {
              targetTitle: 'Signup',
              targetArtifactId: 'signup',
              href: '../signup/v1.html',
              label: 'Start trial'
            }
          ]
        }),
        artifact('signup', 'Signup')
      ],
      doc.objects
    )

    expect(edges).toHaveLength(2)
    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceArtifactId: 'home',
        targetArtifactId: 'signup',
        sourceTitle: 'Home',
        targetTitle: 'Signup',
        label: 'Start trial',
        href: '../signup/v1.html',
        x1: 1280,
        y1: 400,
        x2: 1500,
        y2: 400,
        controlX: 1390,
        controlY: -96
      }),
      expect.objectContaining({
        sourceArtifactId: 'signup',
        targetArtifactId: 'home',
        sourceTitle: 'Signup',
        targetTitle: 'Home',
        href: '../home/v1.html',
        x1: 1500,
        y1: 400,
        x2: 1280,
        y2: 400,
        controlX: 1390,
        controlY: 896
      })
    ]))
  })

  it('resolves by target title and skips hidden frames', () => {
    const doc = createEmptyDocument()
    const homeFrame = createHtmlFrameShape('Home', 0, 0, 'home', 'desktop')
    const hiddenFrame = createHtmlFrameShape('Details', 1500, 0, 'details', 'desktop')
    doc.objects[homeFrame.id] = { ...homeFrame, parentId: doc.rootId }
    doc.objects[hiddenFrame.id] = { ...hiddenFrame, parentId: doc.rootId, visible: false }
    doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [homeFrame.id, hiddenFrame.id] }

    const edges = computePrototypeFlowEdges(
      [
        artifact('home', 'Home', { prototypeLinks: [{ targetTitle: 'Details' }] }),
        artifact('details', 'Details')
      ],
      doc.objects
    )

    expect(edges).toEqual([])
  })

  it('does not connect ambiguous target titles to an arbitrary frame', () => {
    const doc = createEmptyDocument()
    const homeFrame = createHtmlFrameShape('Home', 0, 0, 'home', 'desktop')
    const accountFrame = createHtmlFrameShape('Settings', 1500, 0, 'account-settings', 'desktop')
    const projectFrame = createHtmlFrameShape('Settings', 3000, 0, 'project-settings', 'desktop')
    doc.objects[homeFrame.id] = { ...homeFrame, parentId: doc.rootId }
    doc.objects[accountFrame.id] = { ...accountFrame, parentId: doc.rootId }
    doc.objects[projectFrame.id] = { ...projectFrame, parentId: doc.rootId }
    doc.objects[doc.rootId] = {
      ...doc.objects[doc.rootId],
      children: [homeFrame.id, accountFrame.id, projectFrame.id]
    }

    const edges = computePrototypeFlowEdges(
      [
        artifact('home', 'Home', { prototypeLinks: [{ targetTitle: 'Settings' }] }),
        artifact('account-settings', 'Settings'),
        artifact('project-settings', 'Settings')
      ],
      doc.objects
    )

    expect(edges.some((edge) => edge.sourceArtifactId === 'home')).toBe(false)
  })

  it('adds deterministic fallback flow edges between visible HTML frames', () => {
    const doc = createEmptyDocument()
    const homeFrame = createHtmlFrameShape('Home', 0, 0, 'home', 'desktop')
    const settingsFrame = createHtmlFrameShape('Settings', 1500, 0, 'settings', 'desktop')
    const checkoutFrame = createHtmlFrameShape('Checkout', 3000, 0, 'checkout', 'desktop')
    doc.objects[homeFrame.id] = { ...homeFrame, parentId: doc.rootId }
    doc.objects[settingsFrame.id] = { ...settingsFrame, parentId: doc.rootId }
    doc.objects[checkoutFrame.id] = { ...checkoutFrame, parentId: doc.rootId }
    doc.objects[doc.rootId] = {
      ...doc.objects[doc.rootId],
      children: [homeFrame.id, settingsFrame.id, checkoutFrame.id]
    }

    const edges = computePrototypeFlowEdges(
      [
        artifact('home', 'Home'),
        artifact('checkout', 'Checkout'),
        artifact('settings', 'Settings')
      ],
      doc.objects
    )

    expect(edges.map((edge) => `${edge.sourceArtifactId}->${edge.targetArtifactId}`)).toEqual([
      'home->settings',
      'checkout->home',
      'settings->checkout'
    ])
    expect(edges.map((edge) => edge.href)).toEqual([
      '../settings/v1.html',
      '../home/v1.html',
      '../checkout/v1.html'
    ])
  })

  it('routes skipped horizontal links through an outside lane instead of frame centers', () => {
    const doc = createEmptyDocument()
    const homeFrame = createHtmlFrameShape('Home', 0, 0, 'home', 'desktop')
    const settingsFrame = createHtmlFrameShape('Settings', 1500, 0, 'settings', 'desktop')
    const checkoutFrame = createHtmlFrameShape('Checkout', 3000, 0, 'checkout', 'desktop')
    doc.objects[homeFrame.id] = { ...homeFrame, parentId: doc.rootId }
    doc.objects[settingsFrame.id] = { ...settingsFrame, parentId: doc.rootId }
    doc.objects[checkoutFrame.id] = { ...checkoutFrame, parentId: doc.rootId }
    doc.objects[doc.rootId] = {
      ...doc.objects[doc.rootId],
      children: [homeFrame.id, settingsFrame.id, checkoutFrame.id]
    }

    const edges = computePrototypeFlowEdges(
      [
        artifact('home', 'Home', { prototypeLinks: [{ targetTitle: 'Checkout', targetArtifactId: 'checkout' }] }),
        artifact('settings', 'Settings'),
        artifact('checkout', 'Checkout')
      ],
      doc.objects
    )

    const skippedEdge = edges.find((edge) => edge.sourceArtifactId === 'home' && edge.targetArtifactId === 'checkout')
    expect(skippedEdge).toEqual(expect.objectContaining({
      x1: 1280,
      y1: 400,
      x2: 3000,
      y2: 400,
      controlX: 2140,
      controlY: -96
    }))
  })
})
