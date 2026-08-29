import shellWorkflow from './common/shell-workflow.json'
import workflowConnect from './common/workflow-connect.json'
import phoneComposer from './common/phone-composer.json'
import commandsSdd from './common/commands-sdd.json'
import planBuild from './common/plan-build.json'
import sddFrameworks from './common/sdd-frameworks.json'
import sddMcp from './common/sdd-mcp.json'
import agentsGraph from './common/agents-graph.json'
import codePersonas from './common/code-personas.json'
import workWhiteboard from './common/work-whiteboard.json'
import sidebar from './common/sidebar.json'
import i18nReview from './common/i18n-review.json'
import commandPalette from './common/command-palette.json'
import nodeGraph from './common/node-graph.json'

const common = {
  ...shellWorkflow,
  ...workflowConnect,
  ...phoneComposer,
  ...commandsSdd,
  ...planBuild,
  ...sddFrameworks,
  ...sddMcp,
  ...agentsGraph,
  ...codePersonas,
  ...workWhiteboard,
  ...sidebar,
  ...i18nReview,
  ...commandPalette,
  ...nodeGraph,
}

export default common
