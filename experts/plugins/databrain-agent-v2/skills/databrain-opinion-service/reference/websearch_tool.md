# websearch_tool

Web search fallback for recent events, patch notes, announcements, and external context.

## Usage Notes

- In this skill, web search is typically invoked via platform-integrated web search tool.
- Prefer web search when:
  - game/topic has insufficient DataBrain opinion data
  - user asks highly recent or external event questions
  - tool output explicitly suggests联网搜索

## Rules

- Prioritize reliable sources and include links.
- Do not fabricate source URLs.
- Keep web findings clearly separated from DataBrain internal metrics conclusions.
