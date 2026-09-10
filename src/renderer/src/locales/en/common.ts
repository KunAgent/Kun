import shellWorkflow from './common/shell-workflow.json'
import workflowConnect from './common/workflow-connect.json'
import phoneComposer from './common/phone-composer.json'
import composerFastMode from './common/composer-fast-mode.json'
import commandsSdd from './common/commands-sdd.json'
import providerErrors from './common/provider-errors.json'
import planBuild from './common/plan-build.json'
import sddFrameworks from './common/sdd-frameworks.json'
import sddMcp from './common/sdd-mcp.json'
import agentsGraph from './common/agents-graph.json'
import codePersonas from './common/code-personas.json'
import workWhiteboard from './common/work-whiteboard.json'
import sidebar from './common/sidebar.json'
import i18nReview from './common/i18n-review.json'
import commandPalette from './common/command-palette.json'
import workConversations from './common/work-conversations.json'
import projectBoard from './common/project-board.json'
import speak from './common/speak.json'

const common = {
  queuedMessageEditAccountUnavailable: 'The original model account is unavailable or has changed. The queued message has been kept.',
  queuedMessageEditSteering: 'This message is being delivered as guidance; editing is temporarily unavailable.',
  queuedMessageRestorePending: 'Withdrawn · ready to edit',
  queuedMessageCancelPending: 'Confirming withdrawal',
  queuedMessageStorageFailed: 'Unable to save queued message for editing. Please retry.',
  queuedMessageCancelUnavailable: 'Runtime queue cancellation is unavailable.',
  ...shellWorkflow,
  ...workflowConnect,
  ...phoneComposer,
  ...composerFastMode,
  ...commandsSdd,
  ...providerErrors,
  ...planBuild,
  ...sddFrameworks,
  ...sddMcp,
  ...agentsGraph,
  ...codePersonas,
  ...workWhiteboard,
  ...sidebar,
  ...i18nReview,
  ...commandPalette,
  ...workConversations,
  ...projectBoard,
  ...speak,
}

export default common
