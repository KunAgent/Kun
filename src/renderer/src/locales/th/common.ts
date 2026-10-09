import agentUpdates from './common/agent-updates.json'
import shellWorkflow from './common/shell-workflow.json'
import workflowConnect from './common/workflow-connect.json'
import phoneComposer from './common/phone-composer.json'
import pluginMarket from './common/plugin-market.json'
import pluginsPage from './common/plugins-page.json'
import composerFastMode from './common/composer-fast-mode.json'
import commandsSdd from './common/commands-sdd.json'
import providerErrors from './common/provider-errors.json'
import sddFrameworks from './common/sdd-frameworks.json'
import chatMemory from './common/chat-memory.json'
import sddMcp from './common/sdd-mcp.json'
import agentsGraph from './common/agents-graph.json'
import sidebar from './common/sidebar.json'
import commandPalette from './common/command-palette.json'
import projectBoard from '../en/common/project-board.json'
import speak from './common/speak.json'
import remoteAccess from './common/remote-access.json'

import paper from './common/paper.json'
import paperWorkspace from './common/paper-workspace.json'
import ade from './common/ade.json'
import workLayout from './common/work-layout.json'
import workSidebar from './common/work-sidebar.json'
import workMainline from './common/work-mainline.json'
import usagePanel from './common/usage-panel.json'
import conversationExport from './common/conversation-export.json'
import paperSearch from './common/paper-search.json'
import wardrobePage from './common/wardrobe-page.json'

const common = {
  ...agentUpdates,
  ...shellWorkflow,
  ...workflowConnect,
  ...phoneComposer,
  ...pluginMarket,
  ...pluginsPage,
  ...composerFastMode,
  ...commandsSdd,
  ...providerErrors,
  ...sddFrameworks,
  ...chatMemory,
  ...sddMcp,
  ...agentsGraph,
  ...sidebar,
  ...commandPalette,
  ...projectBoard,
  ...speak,
  ...remoteAccess,
  ...paper,
  ...paperWorkspace,
  ...ade,
  ...workLayout,
  ...workSidebar,
  ...workMainline,
  ...usagePanel,
  ...conversationExport,
  ...paperSearch,
  ...wardrobePage,
}

export default common
