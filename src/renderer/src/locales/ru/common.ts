import shellWorkflow from './common/shell-workflow.json'
import workflowConnect from './common/workflow-connect.json'
import phoneComposer from './common/phone-composer.json'
import commandsSdd from './common/commands-sdd.json'
import providerErrors from './common/provider-errors.json'
import sddFrameworks from './common/sdd-frameworks.json'
import sddMcp from './common/sdd-mcp.json'
import agentsGraph from './common/agents-graph.json'
import sidebar from './common/sidebar.json'
import commandPalette from './common/command-palette.json'
import projectBoard from '../en/common/project-board.json'

const common = {
  ...shellWorkflow,
  ...workflowConnect,
  ...phoneComposer,
  ...commandsSdd,
  ...providerErrors,
  ...sddFrameworks,
  ...sddMcp,
  ...agentsGraph,
  ...sidebar,
  ...commandPalette,
  ...projectBoard,
}

export default common
