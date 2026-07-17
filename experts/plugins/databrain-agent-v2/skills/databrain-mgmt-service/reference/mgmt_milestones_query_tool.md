# mgmt_milestones_query_tool

## Signature

```text
start_date: str          # REQUIRED, YYYY-MM-DD
end_date: str            # REQUIRED, YYYY-MM-DD, must be >= start_date
type: str = "all"        # OPTIONAL, one of: "launch" | "gr" | "checkin" | "all"
```

## `type` parameter (milestone category filter)

The backend `/api/v1/mgmt_pc/chatbi/get_milestones` API filters returned milestones by category via the `type` field. Choose strictly per user intent:

- `type="launch"` — launch milestones such as Soft Launch / Global Launch / Early Access. Use when the user asks about launch / soft-launch / global-launch / EA / 公测 / 上线时间 / 即将上线 / 最近上线.
- `type="gr"` — Gate Review (GR) meetings. GR is used for project review and feedback, with engagement from all relevant assessment teams. The meeting is where the executive team (**GMs and Michelle**) make the **Go/No-Go decision**, approve the budget for the next GR stage, and align on the deliverables and focus for the subsequent GR. Use when the user asks about GR / Gate Review / 管理层评审 / Go/No-Go / 预算审批 / 阶段评审 / 立项评审.
- `type="checkin"` — Check-in meetings. Check-ins are focused on **reviewing updates in specific areas and validating changes to the project mandate**; they should also be used to initiate and discuss mandate change requests. Use when the user asks about check-in / checkin / 项目同步会 / 进展同步会 / mandate 变更 / 项目授权变更 / mandate change.
- `type="all"` (default) — return all milestone types (launch, GR, check-in, major update event, etc.). Use when the user asks broadly without specifying a category, or when the question covers multiple types simultaneously (e.g. "what important milestones are coming up for project X?").

Invalid values automatically fall back to `"all"` and a warning is appended to the tool message.

## Time Window Rules

- Explicit user time window: use it exactly.
- Specific project but no time window: `start_date=2000-01-01`, `end_date=today+5y`.
- Upcoming / 即将上线 / about to launch without time: `start_date=today`, `end_date=today+1y`.
- Recently launched / 最近上线 without time: `start_date=today-1y`, `end_date=today+1y`.
- GR / check-in queries without time: `start_date=today`, `end_date=today+1y` (look forward at upcoming meetings).

`combine_id` is auto-injected from context. Do not pass IDs manually.
If context has one or more combine_ids, the tool calls the API once per combine_id and merges/deduplicates milestones. If context has no combine_id, it queries all projects without a project filter.

The tool's output includes both the searched time window AND the milestone type. The final answer must repeat both.
