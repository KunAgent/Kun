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
  queuedMessageEditAccountUnavailable: '原模型账号不可用或已变更，消息已保留。请恢复原模型连接后重试。',
  queuedMessageEditSteering: '消息正在作为引导送达，暂时无法修改。',
  queuedMessageRestorePending: '已撤回，待编辑',
  queuedMessageCancelPending: '正在确认撤回',
  queuedMessageStorageFailed: '无法保存待编辑消息，请重试。',
  queuedMessageCancelUnavailable: '当前运行时无法撤回排队消息。',
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
