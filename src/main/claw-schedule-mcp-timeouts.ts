/**
 * Budgets shared by the GUI-owned schedule/workflow bridge.
 *
 * The stdio MCP server waits on a workflow run, while Kun cancels the tool call
 * when its own per-call budget expires. If the client budget were shorter than
 * the server-side wait, a healthy long run would surface as a transport failure
 * (and a status-unknown verdict), so both values are defined next to each other.
 */

/** Hard stop the workflow executor applies between nodes. */
export const WORKFLOW_MAX_RUN_DURATION_MS = 30 * 60_000

/** Directory/catalog reads must answer quickly or be reported as unreachable. */
export const WORKFLOW_TOOL_QUERY_TIMEOUT_MS = 5_000

/**
 * How long `run_workflow` waits before reporting an unknown result. The
 * executor only checks its deadline between nodes, so a run can outlive this;
 * the tool then says the result is unknown instead of claiming failure.
 */
export const WORKFLOW_TOOL_WAIT_TIMEOUT_MS = WORKFLOW_MAX_RUN_DURATION_MS

/** Kun per-call budget. Outlives the server-side wait so its verdict arrives first. */
export const GUI_SCHEDULE_MCP_CALL_TIMEOUT_MS = WORKFLOW_TOOL_WAIT_TIMEOUT_MS + 60_000

/**
 * Connect and tool-list budget. Startup has its own independent guard, so this
 * stays short for call-time reconnects and catalog refreshes.
 */
export const GUI_SCHEDULE_MCP_CONNECT_TIMEOUT_MS = 5_000
