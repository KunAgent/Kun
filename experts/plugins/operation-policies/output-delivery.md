# Output Delivery Rules

## Preview Method

**Default (ONLY) method**: Let the host application render the `.design` artifact automatically. Do not output a manual Markdown link, bare file path, `computer://` URL, or "查看设计项目 / 查看 xxx 页面" link in the assistant summary.

**Do NOT** start a local HTTP server (`python -m http.server`, `npx serve`, etc.) or call `OpenPreview` unless the user **explicitly** requests browser preview (e.g., "在浏览器中打开", "show me in browser", "I want to see the HTML preview", "open preview page").

When the user does explicitly request browser preview:
1. Start a local HTTP server pointing to the project directory
2. Call `OpenPreview` with the server URL

## Artifact Declaration (Finish Summary must not include links)

When the task is complete (calling the Finish tool), **the summary must not include any Markdown link, bare path, `computer://` URL, or manual artifact link text**. The host-rendered artifact entry is the only visible entry point for the `.design` artifact.

Forbidden examples:

```
[查看设计项目](computer://...)
查看 design-4 页面
/absolute/path/to/project.design
computer:///absolute/path/to/project.design
```

Rules:
- Finish summary should be short natural language only, in the user's language.
- Mention what changed and that the result is available in the generated artifact entry, but do not create a clickable link yourself.
- The `.design.name` / backend `display_name` is still responsible for the host-rendered artifact title. Do not duplicate it as a manual link in text.
- In redesign-ui flow, the host-rendered artifact entry should point to the duplicate project's `.design` artifact; the textual summary still contains no link.
