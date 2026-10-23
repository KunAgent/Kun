import githubApp from './common/github-app.json'
import composerSubscriptionQuota from './common/composer-subscription-quota.json'
import toolApprovalDetails from './common/tool-approval-details.json'
import toolDetails from './common/tool-details.json'
import toolStates from './common/tool-states.json'
import agentDispatch from './common/agent-dispatch.json'
import taskSuggestion from './common/task-suggestion.json'
import agentUpdates from './common/agent-updates.json'
import roomsPolish from './common/rooms-polish.json'
import executionTasks from './common/execution-tasks.json'
import roomsApproval from './common/rooms-approval.json'
import roomsDirect from './common/rooms-direct.json'
import roomsInitIm from './common/rooms-init-im.json'
import independentAgents from './common/independent-agents.json'
import codexHistory from './common/codex-history.json'
import rooms from './common/rooms.json'
import roomsReplies from './common/rooms-replies.json'
import roomsInteractions from './common/rooms-interactions.json'
import roomsExperience from './common/rooms-experience.json'
import roomsContent from './common/rooms-content.json'
import roomsWorkbench from './common/rooms-workbench.json'
import shellWorkflow from './common/shell-workflow.json'
import workflowConnect from './common/workflow-connect.json'
import phoneComposer from './common/phone-composer.json'
import pluginMarket from './common/plugin-market.json'
import pluginsPage from './common/plugins-page.json'
import composerFastMode from './common/composer-fast-mode.json'
import composerPromptEnhance from './common/composer-prompt-enhance.json'
import commandsSdd from './common/commands-sdd.json'
import providerErrors from './common/provider-errors.json'
import planBuild from './common/plan-build.json'
import sddFrameworks from './common/sdd-frameworks.json'
import sessionActivity from './common/session-activity.json'
import chatMemory from './common/chat-memory.json'
import sddMcp from './common/sdd-mcp.json'
import agentsGraph from './common/agents-graph.json'
import codePersonas from './common/code-personas.json'
import workWhiteboard from './common/work-whiteboard.json'
import sidebar from './common/sidebar.json'
import i18nReview from './common/i18n-review.json'
import commandPalette from './common/command-palette.json'
import composerPanels from './common/composer-panels.json'
import workConversations from './common/work-conversations.json'
import projectBoard from './common/project-board.json'
import speak from './common/speak.json'
import remoteAccess from './common/remote-access.json'

import paper from './common/paper.json'
import paperWorkspace from './common/paper-workspace.json'
import paperEvidence from './common/paper-evidence.json'
import mobileWork from './common/mobile-work.json'
import agentHarness from './common/agent-harness.json'
import agentIntegrations from './common/agent-integrations.json'
import agentCenter from './common/agent-center.json'
import ade from './common/ade.json'
import workLayout from './common/work-layout.json'
import workSidebar from './common/work-sidebar.json'
import workMainline from './common/work-mainline.json'
import conversationManage from './common/conversation-manage.json'
import usagePanel from './common/usage-panel.json'
import conversationExport from './common/conversation-export.json'
import paperSearch from './common/paper-search.json'
import wardrobePage from './common/wardrobe-page.json'
import kunAccount from './common/kun-account.json'
import wardrobeAccount from './common/wardrobe-account.json'
import wardrobeShare from './common/wardrobe-share.json'
import whatsNew from './common/whats-new.json'
import wardrobeInvite from './common/wardrobe-invite.json'
import codeTour from './common/code-tour.json'
import gmail from './common/gmail.json'
import messageQuote from './common/message-quote.json'
import appSurfaces from './common/app-surfaces.json'
import designAgent from './common/design-agent.json'
import designCanvasChrome from './common/design-canvas-chrome.json'
import artifactsLibrary from './common/artifacts-library.json'
import artifactsChat from './common/artifacts-chat.json'
import workspaceFiles from './common/workspace-files.json'
import changesCommit from './common/changes-commit.json'
import turnUndo from './common/turn-undo.json'
import assistantMailbox from './common/assistant-mailbox.json'
import terminalDock from './common/terminal-dock.json'
import pptDeck from './common/ppt-deck.json'
import workersPanel from './common/workers-panel.json'

const common = {
  ...githubApp,
  ...composerSubscriptionQuota,
  ...toolApprovalDetails,
  ...toolDetails,
  ...toolStates,
  ...agentDispatch,
  ...taskSuggestion,
  ...agentUpdates,
  ...roomsInitIm,
  ...roomsDirect,
  ...roomsApproval,
  ...independentAgents,
  ...codexHistory,
  ...rooms,
  ...roomsReplies,
  ...roomsInteractions,
  ...roomsExperience,
  ...roomsContent,
  ...roomsPolish,
  ...roomsWorkbench,
  queuedMessageEditAccountUnavailable: 'The original model account is unavailable or has changed. The queued message has been kept.',
  queuedMessageEditSteering: 'This message is being delivered as guidance; editing is temporarily unavailable.',
  queuedMessageRestorePending: 'Withdrawn · ready to edit',
  queuedMessageCancelPending: 'Confirming withdrawal',
  queuedMessageStorageFailed: 'Unable to save queued message for editing. Please retry.',
  queuedMessageCancelUnavailable: 'Runtime queue cancellation is unavailable.',
  ...shellWorkflow,
  ...workflowConnect,
  ...phoneComposer,
  ...pluginMarket,
  ...pluginsPage,
  ...composerFastMode,
  ...composerPromptEnhance,
  ...commandsSdd,
  ...executionTasks,
  ...providerErrors,
  ...planBuild,
  ...sddFrameworks,
  ...sessionActivity,
  ...chatMemory,
  ...sddMcp,
  ...agentsGraph,
  ...codePersonas,
  ...workWhiteboard,
  ...sidebar,
  ...i18nReview,
  ...commandPalette,
  ...composerPanels,
  ...workConversations,
  ...projectBoard,
  ...speak,
  ...remoteAccess,
  ...paper,
  ...paperWorkspace,
  ...paperEvidence,
  ...mobileWork,
  ...agentHarness,
  ...agentIntegrations,
  ...agentCenter,
  ...ade,
  ...workLayout,
  ...workSidebar,
  ...workMainline,
  ...conversationManage,
  ...usagePanel,
  ...conversationExport,
  ...paperSearch,
  ...wardrobePage,
  ...kunAccount,
  ...wardrobeAccount,
  ...wardrobeShare,
  ...whatsNew,
  ...wardrobeInvite,
  ...codeTour,
  ...gmail,
  ...messageQuote,
  ...appSurfaces,
  ...designAgent,
  ...designCanvasChrome,
  ...artifactsLibrary,
  ...artifactsChat,
  ...workspaceFiles,
  ...changesCommit,
  ...turnUndo,
  ...assistantMailbox,
  ...terminalDock,
  ...pptDeck,
  ...workersPanel
}

export default common
