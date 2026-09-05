/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FloatingComposerTaskProfile } from './FloatingComposerTaskProfile'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function setReactActEnvironment(value: boolean): void {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = value
}

describe('FloatingComposerTaskProfile design style picker interactions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setReactActEnvironment(true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    setReactActEnvironment(false)
    vi.unstubAllGlobals()
  })

  it('flips upward and renders every preset with a vector icon', async () => {
    await act(async () => {
      root.render(createElement(FloatingComposerTaskProfile, {
        surface: 'design',
        locked: false,
        profile: { outputMedium: 'image', target: 'web', preset: 'ios' },
        imageGenerationEnabled: true,
        imageGenerationAvailable: true,
        onProfileChange: vi.fn()
      }))
    })

    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    details!.open = true
    await act(async () => details!.dispatchEvent(new Event('toggle')))

    const trigger = container.querySelector<HTMLButtonElement>('[data-design-style-picker] > button')
    expect(trigger).not.toBeNull()
    vi.spyOn(trigger!, 'getBoundingClientRect').mockReturnValue({
      top: 900,
      bottom: 936,
      left: 0,
      right: 380,
      width: 380,
      height: 36,
      x: 0,
      y: 900,
      toJSON: () => ({})
    })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1100 })

    await act(async () => trigger!.click())

    const listbox = container.querySelector<HTMLElement>('[data-design-style-listbox]')
    expect(listbox?.dataset.placement).toBe('top')
    expect(listbox?.querySelectorAll('[role="option"]')).toHaveLength(14)
    expect(listbox?.querySelectorAll('[data-design-style-icon] svg')).toHaveLength(14)
    expect(listbox?.style.maxHeight).toBe('344px')
  })

  it('renders custom output and target menus with icons and applies selections', async () => {
    const onProfileChange = vi.fn()
    await act(async () => {
      root.render(createElement(FloatingComposerTaskProfile, {
        surface: 'design',
        locked: false,
        profile: { outputMedium: 'image', target: 'web', preset: 'ios' },
        imageGenerationEnabled: true,
        imageGenerationAvailable: true,
        onProfileChange
      }))
    })

    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    details!.open = true
    await act(async () => details!.dispatchEvent(new Event('toggle')))

    const outputTrigger = container.querySelector<HTMLButtonElement>(
      '[data-profile-select="output"] > button'
    )
    expect(outputTrigger).not.toBeNull()
    await act(async () => outputTrigger!.click())

    const outputListbox = container.querySelector<HTMLElement>(
      '[data-profile-select-listbox="output"]'
    )
    expect(outputListbox?.querySelectorAll('[role="option"]')).toHaveLength(2)
    expect(outputListbox?.querySelectorAll('[data-profile-option-icon] svg')).toHaveLength(2)
    const htmlOption = outputListbox?.querySelector<HTMLButtonElement>('[role="option"]')
    await act(async () => htmlOption?.click())
    expect(onProfileChange).toHaveBeenCalledWith({ outputMedium: 'html' })

    const targetTrigger = container.querySelector<HTMLButtonElement>(
      '[data-profile-select="target"] > button'
    )
    expect(targetTrigger).not.toBeNull()
    await act(async () => targetTrigger!.click())

    const targetListbox = container.querySelector<HTMLElement>(
      '[data-profile-select-listbox="target"]'
    )
    expect(targetListbox?.querySelectorAll('[role="option"]')).toHaveLength(2)
    expect(targetListbox?.querySelectorAll('[data-profile-option-icon] svg')).toHaveLength(2)
    const appOption = targetListbox?.querySelectorAll<HTMLButtonElement>('[role="option"]')[1]
    await act(async () => appOption?.click())
    expect(onProfileChange).toHaveBeenCalledWith({ target: 'app' })
  })

  it('removes AI image from the output menu when image generation is disabled', async () => {
    await act(async () => {
      root.render(createElement(FloatingComposerTaskProfile, {
        surface: 'design',
        locked: false,
        profile: { outputMedium: 'html', target: 'web', preset: 'none' },
        imageGenerationEnabled: false,
        imageGenerationAvailable: false,
        onProfileChange: vi.fn()
      }))
    })

    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    details!.open = true
    await act(async () => details!.dispatchEvent(new Event('toggle')))

    const outputTrigger = container.querySelector<HTMLButtonElement>(
      '[data-profile-select="output"] > button'
    )
    await act(async () => outputTrigger?.click())

    const outputListbox = container.querySelector<HTMLElement>(
      '[data-profile-select-listbox="output"]'
    )
    expect(outputListbox?.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(outputListbox?.textContent).not.toContain('designOutputImage')
    expect(outputListbox?.querySelector('[data-profile-option-icon="image"]')).toBeNull()
  })
})
