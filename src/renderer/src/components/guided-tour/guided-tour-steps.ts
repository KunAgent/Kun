import type { GuidedTourSide } from './guided-tour-geometry'

/** The app-wide overview plus one tour per mode. */
export type GuidedTourId = 'overview' | 'code' | 'work' | 'chats'
export type GuidedModeTourId = Exclude<GuidedTourId, 'overview'>
export type GuidedTourArt = 'greet' | 'magic' | 'clip' | 'laptop' | 'wrench' | 'headset' | 'search' | 'cheer'

export type GuidedTourStep = {
  id: string
  /** Real chrome the step points at. Steps whose target is not on screen are skipped. */
  selector: string
  side: GuidedTourSide
  art: GuidedTourArt
  /** The opening card asks to start; the closing card carries the tour's own actions. */
  kind?: 'intro' | 'last'
}

export type GuidedTourDefinition = {
  id: GuidedTourId
  /** The mode the tour explains; the overview runs in whichever mode is open. */
  mode: GuidedModeTourId | null
  /** Present once the mode's own screen has rendered, so the tour can start. */
  readySelector: string
  /** Looser check for a replay the user asked for; screen-specific steps are skipped when absent. */
  replayReadySelector?: string
  steps: readonly GuidedTourStep[]
}

/** Footer ? that opens the tour list. Every tour ends by pointing at it or at its own replay entry. */
export const GUIDED_TOURS_BUTTON = '[data-guided-tours-button]'
const modeTab = (mode: 'chat' | 'write' | 'chats'): string => `.kun-mode-tab[data-workspace-mode="${mode}"]`
const CODE_HOME = '[data-primary-floating-composer]'

export const GUIDED_TOURS: Record<GuidedTourId, GuidedTourDefinition> = {
  overview: {
    id: 'overview',
    mode: null,
    readySelector: '[data-workspace-mode-trigger]',
    steps: [
      { id: 'intro', kind: 'intro', selector: '[data-workspace-mode-trigger]', side: 'right', art: 'greet' },
      { id: 'code', selector: modeTab('chat'), side: 'bottom', art: 'laptop' },
      { id: 'work', selector: modeTab('write'), side: 'bottom', art: 'clip' },
      { id: 'chats', selector: modeTab('chats'), side: 'bottom', art: 'headset' },
      { id: 'newButton', selector: '.sidebar-primary-actions', side: 'right', art: 'magic' },
      { id: 'composer', selector: '[data-floating-composer]', side: 'top', art: 'wrench' },
      { id: 'help', kind: 'last', selector: GUIDED_TOURS_BUTTON, side: 'right', art: 'cheer' }
    ]
  },
  code: {
    id: 'code',
    mode: 'code',
    readySelector: CODE_HOME,
    replayReadySelector: '.sidebar-primary-actions',
    steps: [
      { id: 'intro', kind: 'intro', selector: modeTab('chat'), side: 'bottom', art: 'greet' },
      { id: 'newTask', selector: '.sidebar-primary-actions', side: 'right', art: 'magic' },
      { id: 'projects', selector: '[data-sidebar-section="projects"]', side: 'right', art: 'clip' },
      { id: 'where', selector: `${CODE_HOME} [data-composer-workspace-controls]`, side: 'top', art: 'laptop' },
      { id: 'controls', selector: `${CODE_HOME} .ds-composer-toolbar`, side: 'bottom', art: 'wrench' },
      { id: 'panel', selector: '.code-side-rail', side: 'left', art: 'search' },
      { id: 'replay', kind: 'last', selector: '[data-code-tour-replay]', side: 'bottom', art: 'cheer' }
    ]
  },
  work: {
    id: 'work',
    mode: 'work',
    // The stage loads after the sidebar; wait for its composer so that step is not skipped.
    readySelector: '[data-work-assistant] [data-floating-composer]',
    steps: [
      { id: 'intro', kind: 'intro', selector: modeTab('write'), side: 'bottom', art: 'greet' },
      { id: 'newSession', selector: '[data-work-primary-actions]', side: 'right', art: 'magic' },
      { id: 'artifacts', selector: '.work-sidebar-nav', side: 'right', art: 'cheer' },
      { id: 'space', selector: '.workspace-mode-controls .work-space-switcher', side: 'right', art: 'laptop' },
      { id: 'sessions', selector: '[data-work-section="sessions"]', side: 'right', art: 'headset' },
      { id: 'papers', selector: '[data-work-section="papers"]', side: 'right', art: 'search' },
      { id: 'files', selector: '[data-work-section="files"]', side: 'right', art: 'clip' },
      { id: 'composer', selector: '[data-work-assistant] [data-floating-composer]', side: 'top', art: 'wrench' },
      { id: 'rail', selector: '.write-side-rail', side: 'left', art: 'magic' },
      { id: 'help', kind: 'last', selector: GUIDED_TOURS_BUTTON, side: 'right', art: 'cheer' }
    ]
  },
  chats: {
    id: 'chats',
    mode: 'chats',
    readySelector: '.sidebar-agent-chats',
    steps: [
      { id: 'intro', kind: 'intro', selector: modeTab('chats'), side: 'bottom', art: 'headset' },
      { id: 'list', selector: '.sidebar-agent-chats', side: 'right', art: 'clip' },
      { id: 'newChat', selector: '[data-agent-chats-new]', side: 'right', art: 'magic' },
      { id: 'stage', selector: '[data-agent-chat-stage]', side: 'left', art: 'laptop' },
      { id: 'phone', selector: '.kun-sidebar-phone-button', side: 'right', art: 'search' },
      { id: 'bot', kind: 'last', selector: '[data-agent-chats-new]', side: 'right', art: 'cheer' }
    ]
  }
}

export const GUIDED_MODE_TOURS: readonly GuidedModeTourId[] = ['code', 'work', 'chats']

/** The mode pill's own names for the three modes. */
const MODE_BY_PILL: Record<string, GuidedModeTourId> = { chat: 'code', write: 'work', chats: 'chats' }
const PILL_BY_MODE: Record<GuidedModeTourId, string> = { code: 'chat', work: 'write', chats: 'chats' }

/** Which mode is on screen, read from the mode pill so no view has to report it. */
export function currentGuidedMode(root: ParentNode = document): GuidedModeTourId | null {
  const pill = root.querySelector('[data-workspace-mode-trigger]')
  return MODE_BY_PILL[pill?.getAttribute('data-workspace-mode') ?? ''] ?? null
}

/** Switches modes the way a click on the pill does. */
export function openGuidedMode(mode: GuidedModeTourId, root: ParentNode = document): void {
  root.querySelector<HTMLButtonElement>(modeTab(PILL_BY_MODE[mode] as 'chat'))?.click()
}
