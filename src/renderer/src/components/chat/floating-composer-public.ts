export {
  buildResearchPrompt,
  parseBtwCommand,
  parseCompactCommand,
  parseGoalCommand,
  parseNewCommand,
  parseResearchCommand,
  parseReviewCommand
} from './floating-composer-commands'
export { calculateContextCapacityPopoverPlacement } from './FloatingComposerContextCapacity'
export {
  handleComposerImagePaste,
  imageFilesFromTransfer,
  imageTransferHasImages
} from './FloatingComposerAttachments'
export type {
  ComposerClipboardImageSource,
  ComposerImageTransferSource
} from './FloatingComposerAttachments'
export { calculateComposerMenuScrollTop } from './composer-menu-scroll'
export { shouldCaptureFileMentionCommitKey } from './use-composer-file-mentions'
export { shouldOpenAttachmentPickerOnKeyDown } from './use-floating-composer-actions'
export type { ComposerFileReference } from '../../lib/composer-file-references'
export type { ComposerExecutionSettings } from './FloatingComposerExecutionPicker'
export {
  formatGoalElapsedSeconds,
  returnQueuedMessageToComposer,
  shouldShowGoalFloater,
  shouldShowUsageHistory,
  shouldShowVoiceDictation,
  shouldShowWorkspaceControls,
  shouldSurfaceComposerUserInput
} from './floating-composer-policy'
export type { DesignComposerContext } from '../../design/design-composer-context'
