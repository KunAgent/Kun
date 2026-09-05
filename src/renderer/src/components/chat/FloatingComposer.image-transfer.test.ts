import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer } from 'react-test-renderer'
import {
  FloatingComposer,
  buildResearchPrompt,
  calculateComposerMenuScrollTop,
  calculateContextCapacityPopoverPlacement,
  formatGoalElapsedSeconds,
  handleComposerImagePaste,
  imageFilesFromTransfer,
  imageTransferHasImages,
  parseCompactCommand,
  parseGoalCommand,
  parseNewCommand,
  parseResearchCommand,
  parseReviewCommand,
  returnQueuedMessageToComposer,
  shouldCaptureFileMentionCommitKey,
  shouldOpenAttachmentPickerOnKeyDown,
  shouldShowVoiceDictation,
  shouldShowGoalFloater,
  shouldShowUsageHistory,
  shouldShowWorkspaceControls,
  shouldSurfaceComposerUserInput
} from './FloatingComposer'
import { COMPOSER_INPUT_HISTORY_STORAGE_KEY } from './use-composer-input-history'
import {
  FloatingComposerModelPicker,
  buildComposerModelMenuGroups,
  calculateFloatingReasoningPopoverPlacement,
  calculateFloatingMenuPlacement,
  calculateFloatingSubmenuPlacement,
  composerReasoningEffortForRailKey,
  composerReasoningEffortHasEnergyMotion,
  composerReasoningEffortForRailPosition,
  composerReasoningRailPointerPosition,
  composerReasoningRailPosition,
  composerModelMenuItemSelected,
  composerMenuSupportsModel,
  composerReasoningEffortRequestValue,
  buildComposerModelOptions,
  filterComposerModelIds,
  normalizeComposerReasoningEffort,
  orderComposerReasoningRailEfforts
} from './FloatingComposerModelPicker'
import {
  FloatingComposerExecutionPicker,
  FloatingComposerPermissionMenuContent,
  calculateExecutionMenuPlacement
} from './FloatingComposerExecutionPicker'
import {
  FloatingComposerQueuedMessages,
  calculateQueuedMessageMenuPlacement
} from './FloatingComposerQueuedMessages'
import { FloatingComposerAboveInputStack } from './FloatingComposerAboveInputStack'
import { requestContextSnapshotMatchesSelection } from './FloatingComposerContextCapacity'
import { getGoalPanelDraftObjective } from './floating-composer-commands'
import { useChatStore } from '../../store/chat-store'
import { useGraphStore } from '../../graph/graph-store'
import i18n from '../../i18n'
import {
  buildComposerFileContextPrompt,
  filterWorkspaceFileMentionSuggestions,
  formatComposerFileMentionToken,
  getFileMentionAtCursor,
  hasComposerFileMentionToken,
  isFileWithinDirectory,
  removeComposerFileMentionToken,
  replaceFileMentionInInput,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import { filesUnderDirectory } from '../../lib/workspace-file-index'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'

const DEEPSEEK_PROVIDER_GROUP = {
  providerId: 'deepseek',
  label: 'DeepSeek',
  modelIds: ['deepseek-v4-pro', 'deepseek-v4-flash']
}

const CODEX_PROVIDER_GROUP: ModelProviderModelGroup = {
  providerId: 'codex-2',
  presetSource: 'codex',
  label: 'ChatGPT subscription 2',
  modelIds: ['gpt-5.4', 'gpt-5.4-mini'],
  modelProfiles: {
    'gpt-5.4': {
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text', 'image_url'],
      serviceTiers: ['priority']
    },
    'gpt-5.4-mini': {
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text', 'image_url']
    }
  }
}

describe('FloatingComposer image transfer helpers', () => {
  it('extracts image files from clipboard or drop payloads', () => {
    const screenshot = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
    const pastedWebp = new File([new Uint8Array([4])], '', { type: 'image/webp' })
    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const source = {
      items: {
        length: 3,
        0: { kind: 'file', type: 'image/webp', getAsFile: () => pastedWebp },
        1: { kind: 'file', type: 'text/plain', getAsFile: () => notes },
        2: { kind: 'string', type: 'text/plain', getAsFile: () => null }
      },
      files: {
        length: 2,
        0: screenshot,
        1: notes
      }
    }

    expect(imageFilesFromTransfer(source)).toEqual([pastedWebp, screenshot])
    expect(imageTransferHasImages(source)).toBe(true)
  })

  it('deduplicates files exposed through both transfer item and file lists', () => {
    const screenshot = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
    const source = {
      items: {
        length: 1,
        0: { kind: 'file', type: 'image/png', getAsFile: () => screenshot }
      },
      files: {
        length: 1,
        0: screenshot
      }
    }

    expect(imageFilesFromTransfer(source)).toEqual([screenshot])
  })

  it('keeps clipboard item MIME hints when pasted image files omit their own type', () => {
    const screenshot = new File([new Uint8Array([1])], 'shot', { type: '' })
    const source = {
      items: {
        length: 1,
        0: { kind: 'file', type: 'image/png', getAsFile: () => screenshot }
      },
      files: {
        length: 0
      }
    }

    const [file] = imageFilesFromTransfer(source)

    expect(file).toBeInstanceOf(File)
    expect(file?.type).toBe('image/png')
    expect(file?.name).toBe('shot')
    expect(imageTransferHasImages(source)).toBe(true)
  })

  it('routes pasted image files through the clipboard bridge when available', () => {
    const screenshot = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
    const preventDefault = vi.fn()
    const onPickAttachments = vi.fn()
    const onPasteClipboardImage = vi.fn()
    const handled = handleComposerImagePaste({
      canPickAttachment: true,
      clipboardData: {
        getData: () => '',
        items: {
          length: 1,
          0: { kind: 'file', type: 'image/png', getAsFile: () => screenshot }
        }
      },
      preventDefault,
      onPickAttachments,
      onPasteClipboardImage
    })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onPickAttachments).not.toHaveBeenCalled()
    expect(onPasteClipboardImage).toHaveBeenCalledWith({ silentNoImage: false })
  })

  it('still uses the attachment picker for pasted image files when the clipboard bridge is unavailable', () => {
    const screenshot = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
    const preventDefault = vi.fn()
    const onPickAttachments = vi.fn()
    const handled = handleComposerImagePaste({
      canPickAttachment: true,
      clipboardData: {
        getData: () => '',
        items: {
          length: 1,
          0: { kind: 'file', type: 'image/png', getAsFile: () => screenshot }
        }
      },
      preventDefault,
      onPickAttachments
    })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onPickAttachments).toHaveBeenCalledWith([screenshot])
  })

  it('does not intercept ordinary text paste', () => {
    const preventDefault = vi.fn()
    const onPasteClipboardImage = vi.fn()
    const handled = handleComposerImagePaste({
      canPickAttachment: true,
      clipboardData: {
        getData: (format) => format === 'text/plain' ? 'hello' : ''
      },
      preventDefault,
      onPasteClipboardImage
    })

    expect(handled).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(onPasteClipboardImage).toHaveBeenCalledWith({ silentNoImage: true })
  })

  it('falls back to the Electron clipboard image bridge when files are unavailable', () => {
    const preventDefault = vi.fn()
    const onPasteClipboardImage = vi.fn()
    const handled = handleComposerImagePaste({
      canPickAttachment: true,
      clipboardData: {
        getData: () => ''
      },
      preventDefault,
      onPasteClipboardImage
    })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onPasteClipboardImage).toHaveBeenCalledWith({ silentNoImage: false })
  })
})

describe('composer attachment shortcut', () => {
  const modifiers = {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false
  }

  it('triggers for Ctrl+U and Cmd+U when attachments are available', () => {
    expect(shouldOpenAttachmentPickerOnKeyDown(
      { ...modifiers, key: 'u', ctrlKey: true },
      { composing: false, canPickAttachment: true }
    )).toBe(true)
    expect(shouldOpenAttachmentPickerOnKeyDown(
      { ...modifiers, key: 'U', metaKey: true },
      { composing: false, canPickAttachment: true }
    )).toBe(true)
  })

  it('does not trigger while composing, with Alt/Shift modifiers, or without capability', () => {
    expect(shouldOpenAttachmentPickerOnKeyDown(
      { ...modifiers, key: 'u', ctrlKey: true },
      { composing: true, canPickAttachment: true }
    )).toBe(false)
    expect(shouldOpenAttachmentPickerOnKeyDown(
      { ...modifiers, key: 'u', ctrlKey: true, altKey: true },
      { composing: false, canPickAttachment: true }
    )).toBe(false)
    expect(shouldOpenAttachmentPickerOnKeyDown(
      { ...modifiers, key: 'u', ctrlKey: true, shiftKey: true },
      { composing: false, canPickAttachment: true }
    )).toBe(false)
    expect(shouldOpenAttachmentPickerOnKeyDown(
      { ...modifiers, key: 'u', ctrlKey: true },
      { composing: false, canPickAttachment: false }
    )).toBe(false)
  })

  it('ignores plain U, Enter, and unrelated keys', () => {
    expect(shouldOpenAttachmentPickerOnKeyDown(
      { ...modifiers, key: 'u' },
      { composing: false, canPickAttachment: true }
    )).toBe(false)
    expect(shouldOpenAttachmentPickerOnKeyDown(
      { ...modifiers, key: 'Enter', ctrlKey: true },
      { composing: false, canPickAttachment: true }
    )).toBe(false)
  })
})
