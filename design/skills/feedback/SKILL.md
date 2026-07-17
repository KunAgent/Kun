---
name: feedback
description: "Use only for explicit TRAE feedback submission intent: when the user explicitly invokes /feedback, the host injects Use Skill: feedback, or the user clearly asks to submit/send/record/report their own current TRAE issue as feedback. Do not activate merely because the user mentions feedback, bug, complaint, feedback page, feedback API, or user feedback data. If uncertain, do not activate."
user-invocable: true
disable-model-invocation: false
---

# Feedback

## Overview

Use this skill only to turn an explicit TRAE feedback/reporting flow into the smallest possible feedback JSON for the host product.

The agent's responsibility is only:

1. Understand the user's feedback intent.
2. Clarify once at a time only when the intent is not yet usable.
3. Once the intent is clear, first write one short, natural sentence saying the feedback is ready and the user can keep talking to add details, then output one minimal JSON object containing the merged text and related image resource identifiers.
4. When the user adds follow-up details, merge only within the latest active, not-closed feedback item.

Use the user's current language for all user-facing conversation, including clarification questions and the short sentence before JSON. If the user writes in Chinese, respond in Chinese. If the user writes in English, respond in English. If the user uses another language, respond in that language when possible. The JSON protocol field names and fixed `issueTag` values must remain exactly as specified below.

The Feedback Skill runtime may provide server-side feedback boundary metadata. Treat every item marked `closed` as a hard boundary: it was already confirmed or cancelled. Never reuse its text or image resource identifiers in a later JSON object, even when the user says they want to add more information or continue the conversation.

Do not create, copy, edit, inject, or reference any HTML template. Do not create local files. Do not open previews. Do not start servers. Do not submit feedback. The client-side product owns all downstream UI, preview, confirmation, attachment, and submission behavior.

## Strict Activation Gate

Be conservative. Activate this skill only when at least one of these conditions is unquestionably true:

1. The user explicitly invokes `/feedback` or `/feedback <description>`.
2. The host explicitly injects `Use Skill: feedback` for the current turn.
3. The user clearly asks to submit, send, record, or report their own current TRAE problem as product feedback, for example: "report this issue to TRAE", "submit a feedback item", or "record and send this problem".
4. The user is directly answering this skill's immediately preceding clarification, or explicitly adding details to the newest unclosed feedback item.

The words `feedback`, `bug`, `issue`, `complaint`, `suggestion`, `反馈`, `问题反馈`, or similar terms are never sufficient by themselves. A complaint such as "it is slow" is also insufficient unless the current turn was entered through `/feedback`, host injection, or an explicit request to submit it as feedback.

Never activate this skill for work whose subject happens to be feedback. Handle these as ordinary requests:

- Developing, designing, debugging, testing, or reviewing a feedback feature, feedback form, feedback button, confirmation page, API, Skill, or data model.
- Writing code, specs, tests, copy, documentation, or analytics that mention feedback.
- Summarizing, translating, classifying, searching, or discussing user feedback or feedback data.
- Asking how feedback works, how to implement it, or why it was triggered.
- A normal development request that merely contains a variable, route, file, component, or product name containing `feedback`.

If a message mixes an ordinary task with feedback-related words, the ordinary task wins unless the user separately and explicitly asks to submit their own current TRAE issue. If intent is uncertain, do not invoke this skill, do not output feedback JSON, and do not ask whether the user wants to submit feedback; answer the ordinary request normally.

## Scope And Exit Rules

Only apply this skill when the current turn is explicitly a feedback/reporting flow:

- The user sends `/feedback` or `/feedback <description>`.
- The host prepends metadata such as `Use Skill: feedback`.
- The user clearly asks to submit, record, report, or send feedback about TRAE.
- The user is directly answering a clarification question that this skill just asked.
- The user adds more details or another problem to the newest unclosed feedback item, especially with additive wording such as "also", "another issue", "add one more thing", "by the way", "还有", "另外", or "补充".

Do not apply this skill to ordinary user requests, even if they contain feedback-related keywords or could be interpreted as a product idea. Examples include: "build a feedback feature", "modify the feedback page", "write tests for the feedback API", "summarize these user feedback items", "build an app", "write code", "look this up", "explain this", "edit this file", "generate an image", or any other development, writing, research, creation, analysis, or troubleshooting task.

If the current user message is an ordinary request rather than feedback, stop applying this skill and answer normally. Do not output feedback JSON.

A previous feedback turn does not make later unrelated turns feedback. Feedback mode only continues for direct clarification answers or same-feedback follow-up details.

## Core Principle

Treat feedback collection as a lightweight intent-to-JSON task, not a diagnosis form.

Preserve the user's wording as much as possible while merging later clarifications into the latest user-facing problem description. Ask only when the current text is too empty or ambiguous to become useful feedback. Once the feedback is clear enough, stop asking and output the continuation sentence plus JSON immediately.

## Output Contract

When the feedback intent is clear, reply with exactly two parts in this order:

1. One short sentence generated from the current feedback context, in the user's current language. Say plainly that this feedback is ready and that the user can continue talking to add details or another related problem. Vary the wording naturally; do not use a fixed slogan, sound formal, or claim the feedback was submitted.
2. One valid JSON object on the next line. Do not wrap it in Markdown or a code fence.

Canonical minimal shape:

```json
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "The final user-facing feedback description, merged from clarifications and follow-ups",
  "issueTag": "请求失败/卡住/排队",
  "prefillPhotoTosUris": ["Stable image keys extracted from conversation image references"]
}
```

Field rules:

- `feedbackSkillVersion` is the built-in transport discriminator. Always output it first and always set it to exactly `"v2"`.
- `rawUserText` is the latest merged user-facing feedback description. Keep it in the user's language unless the user asks otherwise.
- `issueTag` is exactly one visible routing tag from the fixed list below whenever the feedback text is usable. These tag values are protocol constants; do not translate them. When several problems are merged, choose the single closest tag instead of returning `""`.
- `prefillPhotoTosUris` is the ordered, deduplicated list of stable image keys extracted from user-uploaded or user-referenced conversation images that belong to the feedback. Image references may appear in multiple formats, including UUID-like names, TOS paths, bracketed resource strings, file paths, or other host-provided image references. Extract the stable key according to the image key extraction rules below instead of outputting full local/TOS paths. Use `[]` when no conversation image belongs to this feedback.
- Do not output any other JSON fields beyond these four protocol fields.
- Do not output signed image URLs, image bytes, lossy rewritten filenames in place of the original image identifiers, `feedbackId`, `feedbackChannel`, `triggerMode`, task IDs, logs, device metadata, confidence, AI summaries, or hidden inferred fields.
- Do not output patch/update/diff JSON. For follow-up details, always output the full latest JSON object.

## Merge Rules

Maintain the active feedback intent only while the user is still in the same feedback/reporting flow:

- Default to merging into the newest unclosed feedback item. An unclosed item may contain multiple symptoms, requests, or problem categories; semantic difference alone is not a reason to split it.
- Treat additive wording such as "also", "another issue", "add one more thing", "by the way", "还有个问题", "补充个问题", "另外", "还有", "再加一条", or equivalent wording as an explicit request to merge into the newest unclosed item.
- Split into a new feedback item only when the previous item is marked `closed`, or the user explicitly asks to create a separate item with wording such as "submit this separately", "new feedback item", "do not merge this with the previous one", `单独反馈`, `新建一条`, or an equivalent unambiguous instruction.
- A feedback item becomes permanently closed when the server-side Skill context marks it `closed`.
- After a closed boundary, the next report is a new independent feedback item. Use only text and images after that boundary.
- Never reopen, edit, or merge into a closed item. If the user explicitly wants to add something after submission/cancellation, create a new JSON object for the new content only.
- If there is a newer unclosed feedback item after the boundary, follow-ups may merge with that newest unclosed item, but never with any earlier closed item.
- If the user clarifies ambiguous feedback, merge the clarification into `rawUserText`.
- If the user adds more context, another problem, or a product suggestion while the item is unclosed, append or rewrite all included points naturally into one latest `rawUserText`.
- After every merge, select one closest `issueTag` for the full item. Prefer the problem the user emphasizes as primary; otherwise prefer the most concrete and actionable symptom; if they are equally concrete, prefer the newest added problem. Never clear the tag merely because the merged problems span different categories.
- If the user adds an image for the same issue, retain the existing relevant identifiers and append the new relevant identifier in conversation order.
- When a clarification answer or follow-up message contains both concrete feedback text and one or more uploaded or referenced images, treat those same-message images as evidence for that feedback by default. Include their exact identifiers unless the user says an image is unrelated.
- Do not require the user to say "this image", "as shown", `这张图`, `如图`, or similar wording. Uploading an image together with a concrete symptom is enough to relate it to that symptom.
- If later text does not refer to a nearby image, do not attach that image merely because it is in the same or an adjacent turn.
- If the user explicitly removes an image or says it is unrelated, remove its identifier from `prefillPhotoTosUris`.
- If the user explicitly says they want to replace the feedback, replace both the previous description and its image list.
- Do not infer a new feedback item merely because the added problem is unrelated to the first one. Require an explicit split instruction or a closed boundary.
- If the user starts an unrelated ordinary task, exit this skill and handle that task normally.
- Preserve the user's concrete wording. Do not over-polish, diagnose, or translate emotional wording into internal categories.

Image selection rules:

- Decide image membership while deciding which descriptions belong to the same active feedback item.
- Before producing JSON, scan the full raw current user message text, not only the text inside `<user_input>` and not only `<uploaded_files>`. The raw user message may contain image references before or after `<user_input>`, between system reminders, or as standalone lines.
- Collect stable image keys from image references exposed in the conversation or message metadata. Valid references can include `image_id` values, TOS resource paths such as `tos-cn-i-example/cn/account/image/example_image_key_png_800x600`, bracketed resource strings such as `[tos-cn-i-example/cn/account/image/example_image_key_png_800x600]`, upload file paths such as `/workspace/.uploads/example-upload-image.png`, or other host-provided image references. Never invent, translate, or convert an identifier into a signed URL.
- Do not rely on seeing a visual image preview. The authoritative signal for `prefillPhotoTosUris` is the textual image reference in the raw prompt context. If the raw user message contains a textual image reference, extract it even if it is outside `<user_input>`.
- Runtime prompt context often emits TOS images as standalone bracketed lines outside `<uploaded_files>`, usually immediately after a `<user_input>...</user_input>` block and before the assistant/tool messages. Example shape:

```text
<user_input>
Use Skill: feedback The app is stuck in a loop
</user_input>

[tos-cn-i-example/cn/account/image/example_runtime_image_key_png_800x600]
```

  Treat that bracketed TOS line as a user-referenced image for the same turn and extract `example_runtime_image_key_png_800x600` into `prefillPhotoTosUris`, unless the user explicitly says the image is unrelated.
- If the current feedback turn contains any standalone bracketed TOS image line like `[tos-.../image/<key>]`, `prefillPhotoTosUris` must include `<key>`. Do not output `[]` merely because there is no `<uploaded_files>` block or because the image reference is outside `<user_input>`.
- Let the model judge whether a referenced resource is an image from the surrounding metadata, path, extension, MIME-like hints, or context. Do not hard-code a single image identifier pattern.
- Read image metadata from the current clarification or follow-up message before producing JSON. If that message contains a concrete symptom plus image metadata or image-looking resource references, do not output `[]`; copy every same-message image identifier that the user did not exclude.
- Include every user-uploaded image in the active feedback boundary when it is part of the feedback turn or follow-up, unless the user explicitly says the image is unrelated. Do not require a strict semantic match between the image content and the feedback text.
- Deduplicate aliases of the same image when the metadata makes the equivalence clear; otherwise preserve distinct exact identifiers.
- If no exact stable image identifier is available, do not guess one.

Image key extraction rules:

- For upload file paths, output only the basename, including extension. Example: `/workspace/.uploads/example-upload-image.png` becomes `example-upload-image.png`.
- For TOS image paths, output only the segment after `/image/`. Example: `tos-cn-i-example/cn/account/image/example_tos_image_key_png_800x600` becomes `example_tos_image_key_png_800x600`.
- For bracketed TOS image references, first remove surrounding whitespace and the surrounding brackets, then apply the TOS rule. Example: `[tos-cn-i-example/cn/account/image/example_tos_image_key_png_800x600]` becomes `example_tos_image_key_png_800x600`.
- A bracketed line that starts with `[tos-`, contains `/image/`, and ends with `]` should be treated as an image reference even when it is not inside an uploaded-files block.
- For already-normalized image keys, keep the key as-is.
- Do not output full `/workspace/.uploads/...` paths or full `tos-.../image/...` paths in `prefillPhotoTosUris`.

Good merge examples:

The merge snippets below show only the JSON portion for brevity. In an actual clear-feedback response, always generate the short continuation sentence before it, in the user's current language.

- User: `Too laggy`
- Agent: `Is the UI lagging, is the task not moving, or is generation slow? One short sentence is enough.`
- User: `The UI is lagging and buttons respond slowly`
- JSON:

```json
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "The UI is lagging and buttons respond slowly",
  "issueTag": "界面/交互体验",
  "prefillPhotoTosUris": []
}
```

- User later: `Also show whether it is still loading, otherwise it looks frozen`
- JSON:

```json
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "The UI is lagging and buttons respond slowly; also show whether it is still loading, otherwise it looks frozen",
  "issueTag": "界面/交互体验",
  "prefillPhotoTosUris": []
}
```

- Active JSON: `{"feedbackSkillVersion":"v2","rawUserText":"My membership expired","issueTag":"付费/额度/速通","prefillPhotoTosUris":[]}`
- User later: `Add one more thing: the system is overloaded`
- Merged JSON:

```json
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "My membership expired; the system is overloaded",
  "issueTag": "请求失败/卡住/排队",
  "prefillPhotoTosUris": []
}
```

The second problem remains in the same active item because the user explicitly said it was an addition. Because neither problem was declared primary, the newer concrete failure symptom determines the single closest tag.

## Issue Tags

Set `issueTag` to exactly one of these values for every usable feedback item. These values are fixed protocol strings and must not be translated. For merged problems, apply the priority rule above and select the closest single tag; multiple categories are not a reason to use `""`.

| Tag | Use for |
| --- | --- |
| `AI 生成/执行效果` | The agent answers the wrong thing, edits the wrong file, deletes/overwrites unexpectedly, goes off track, has poor model quality, or cannot finish a long task. |
| `请求失败/卡住/排队` | Model request failure, endless thinking, network/server errors, abnormal queueing, task cannot stop/continue. |
| `文件修改与代码应用` | Edit/Fast Apply does not work, code is not applied, mojibake, diff issues, document/docx read failure, artifact download failure. |
| `远程开发/WSL/SSH` | SSH failure, remote environment unavailable, WSL path/file read issues, Cloud IDE timeout, remote AI panel loading failure. |
| `付费/额度/速通` | Fast Pass not taking effect, quota deducted after task failure, balance/bonus unavailable, unclear quota, subscription/refund/invoice issues. |
| `账号/登录/设备` | Login failure, device limit, account abnormality, SSO/email/phone login issues, unable to modify account info. |
| `安装/升级/性能` | Install failure, auto-update issues, missing features after upgrade, startup problems, crash, black screen, lag, high CPU/memory. |
| `界面/交互体验` | Popup blocking, accidental button taps, low-resolution layout issues, dark mode readability, small font, sidebar/layout problems. |
| `产品建议/功能需求` | New feature suggestions, custom shortcuts, history/session management, model management improvements, tray residency, launch on startup, workspace/task management, etc. |
| `其他` | The feedback is concrete enough but truly does not fit any category above. |

Do not use `issueTag` as a reason to skip clarification. Category-only reports like "there is a bug" still need one short question first because they do not describe what happened.

## Flow

1. Understand intent.
   - If the user sends `/feedback <description>`, strip the command prefix and treat the remaining text as the initial feedback.
   - If the host prepends metadata such as `Use Skill: feedback`, strip it before interpreting the user's feedback.
   - If the user sends only `/feedback`, inspect current conversation/task context before asking anything.
   - If the current task context clearly identifies the issue, use it only to help form a user-facing `rawUserText`. Do not add technical metadata to JSON.

2. If the intent is clear, output the short continuation sentence and JSON immediately.
   - Clear means the user gave a concrete symptom, complaint, or desired change.
   - Before writing JSON, scan the full raw current user message for image references. If it contains `[tos-.../image/<key>]`, include `<key>` in `prefillPhotoTosUris`.
   - Do not ask optional follow-ups.
   - Do not restate the full report in prose; the sentence only confirms readiness and invites further details.
   - Do not create a page or file.

3. If the intent is unclear, ask one short clarification.
   - Ask in normal chat, using the user's current language.
   - Do not use `ask_user_question`, `request_user_input`, or any equivalent blocking choice-prompt tool.
   - Ask at most one question at a time.
   - Once the user answers with usable feedback text, output the continuation sentence and minimal JSON in that same turn.

4. If the user adds follow-up information, merge it, generate a fresh continuation sentence, and output JSON.
   - Combine the existing feedback and the new user-provided details into the latest `rawUserText`, including multiple distinct problems when the item is still unclosed.
   - Before writing JSON, rescan the full raw current user message for standalone TOS image lines or upload paths, even if they appear outside `<user_input>`.
   - Re-evaluate `prefillPhotoTosUris` using the same feedback boundary; retain still-relevant identifiers, add newly related identifiers, and remove identifiers that no longer belong.
   - If the follow-up is also the answer to a clarification and includes uploaded or referenced images, include those image identifiers in the fresh full JSON. Do not lose them merely because the earlier ambiguous turn had no images.
   - Re-select exactly one closest `issueTag` after the merge. Do not output an empty tag merely because the item contains multiple problems.
   - Generate a fresh continuation sentence and output the full current JSON object, not an incremental update.

## Decision Rules

Use these rules for `/feedback` with no description:

- Strong context: the user recently complained, a task failed, the app crashed, or the agent is visibly stuck. Offer 2-4 short candidate feedback sentences for the user to pick, edit, or reject.
- Medium context: the session has a suspicious state, such as long waiting, repeated retries, permission prompts, or result-quality complaints. Ask whether the user wants to report that issue in one sentence.
- Weak context: no clear signal. Ask the user to describe the issue in one sentence.

Use these rules for emotionally clear but operationally vague text:

- If the user only names an issue category without a symptom, such as "there is a bug", "bug", "there is a problem", "broken", `有个 bug`, `有问题`, or `出问题了`, ask one lightweight clarification before outputting JSON.
- If the user only says "too laggy", "slow", `太卡`, `很卡`, `好卡`, or similar, ask one lightweight clarification because the target of the lag is unclear.
- If the user says the result is wrong, keeps being wrong, "it keeps editing the wrong thing", "it is going off track", `一直改不对`, `越改越偏`, `没改到点上`, or similar, preserve that wording and output the continuation sentence plus JSON. Do not classify the failure mode beyond a visible `issueTag` when clear.
- If the user reports broad symptoms such as "many errors", "keeps failing", "many problems", "frozen", `各种报错`, `一直失败`, `很多问题`, `卡死了`, or combines several symptoms, preserve the broad wording and output the continuation sentence plus JSON unless the text is blank or unusable.
- If the user refuses to add detail, continue with the available user text and output the continuation sentence plus JSON when it is minimally usable.

## Do Not Infer

Do not add or fill any hidden inferred fields. Never output:

- `problem_type`
- `where_it_happened`
- `user_expectation`
- `evidence_to_include`
- `ai_summary`
- `ai_inferred`
- `confidence`
- `feedbackId`
- `feedbackChannel`
- `triggerMode`
- `sourceMessageId`
- `conversationExcerpt`
- `taskId`
- `taskState`
- `recentActionRefs`
- `logRefs`
- `screenshotRef`
- `deviceName`
- `osName`
- `browserName`
- `memoryState`
- `architecture`
- `descriptionPlaceholder`
- `feedbackType`

The only allowed output fields are `feedbackSkillVersion`, `rawUserText`, `issueTag`, and `prefillPhotoTosUris`. Always output all four keys, with `feedbackSkillVersion` first and exactly equal to `"v2"`. For usable feedback, `issueTag` must be one exact fixed-list value, including `其他` only when no closer category exists; use `[]` when no image belongs to the feedback.

## User-Facing Voice

Use the user's current language for all user-visible text. When asking clarification, be calm, short, and concrete. The agent is helping the user report a problem, not debating whether the product behaved correctly.

Good clarification wording:

- English user: `What exactly went wrong? One short sentence about the symptom is enough.`
- English user: `Is the UI lagging, is the task not moving, or is generation slow? One short sentence is enough.`
- Chinese user: `具体是什么 bug？一句话说现象就行。`
- Chinese user: `是界面操作卡、任务一直没进展，还是生成结果慢？一句话就行。`

Generate completion wording from the current turn's meaning and conversational tone. Do not select from a phrase list, reuse a stock sentence, or copy wording from earlier feedback turns. Completion wording is intentionally omitted from most examples so it cannot become a template. Avoid:

- Mentioning templates, HTML, files, previews, local links, artifacts, or JSON implementation details.
- Asking for logs or technical identifiers the product can attach automatically.
- Asking optional product-suggestion follow-ups after the feedback is already clear.
- Repeating the full feedback summary before the JSON.

## Examples

### Clear `/feedback`

User:

```text
/feedback It got stuck installing dependencies and did not move for a long time
```

Agent JSON portion (the independently generated continuation sentence is omitted here):

```text
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "It got stuck installing dependencies and did not move for a long time",
  "issueTag": "请求失败/卡住/排队",
  "prefillPhotoTosUris": []
}
```

### Category-Only Bug Report

User:

```text
There is a bug
```

Agent:

```text
What exactly went wrong? One short sentence about the symptom is enough.
```

User:

```text
SSH keeps failing to connect
```

Agent JSON portion:

```json
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "SSH keeps failing to connect",
  "issueTag": "远程开发/WSL/SSH",
  "prefillPhotoTosUris": []
}
```

### Bare Lag Complaint

User:

```text
Too laggy
```

Agent:

```text
Is the UI lagging, is the task not moving, or is generation slow? One short sentence is enough.
```

User:

```text
The task is not moving
```

Agent JSON portion:

```json
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "The task is not moving",
  "issueTag": "请求失败/卡住/排队",
  "prefillPhotoTosUris": []
}
```

### Follow-Up Merge

User:

```text
Add one more sentence: I want it to show what it is doing
```

Agent JSON portion:

```json
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "The task is not moving; I want it to show what it is doing",
  "issueTag": "请求失败/卡住/排队",
  "prefillPhotoTosUris": []
}
```

### Product Suggestion

User:

```text
/feedback I hope it can support auto review
```

Agent JSON portion:

```json
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "I hope it can support auto review",
  "issueTag": "产品建议/功能需求",
  "prefillPhotoTosUris": []
}
```

### Image In A Clarification Answer

The user first says `I want to report an issue`, so the agent asks what happened.

The user then uploads or references image `[tos-cn-i-example/cn/account/image/example_clarification_image_key_png_800x600]` and says:

```text
The page is stuck
```

Agent JSON portion:

```json
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "The page is stuck",
  "issueTag": "请求失败/卡住/排队",
  "prefillPhotoTosUris": ["example_clarification_image_key_png_800x600"]
}
```

The image belongs to the feedback because it was uploaded or referenced together with the concrete clarification. The earlier vague message having no image does not make this list empty. For TOS-style references, output the stable key after `/image/`, not the full TOS path.

### Runtime TOS Line Outside User Input

Runtime prompt context may place the image line outside `<user_input>`:

```text
<user_input>
Use Skill: feedback 死循环了
</user_input>

[tos-cn-i-example/cn/account/image/example_runtime_image_key_png_800x600]
```

Agent JSON portion:

```json
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "死循环了",
  "issueTag": "请求失败/卡住/排队",
  "prefillPhotoTosUris": ["example_runtime_image_key_png_800x600"]
}
```

The bracketed TOS line belongs to the same current turn even though it is outside `<user_input>` and outside `<uploaded_files>`.

### Related Images Across Follow-Ups

User uploads image `/workspace/.uploads/example-ui-image.png` and says:

```text
The UI here is not aligned
```

Agent JSON portion:

```json
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "The UI here is not aligned",
  "issueTag": "界面/交互体验",
  "prefillPhotoTosUris": ["example-ui-image.png"]
}
```

User then uploads or references image `example-icon-image.png` and says:

```text
This icon is wrong too
```

Agent JSON portion:

```json
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "The UI here is not aligned; this icon is wrong too",
  "issueTag": "界面/交互体验",
  "prefillPhotoTosUris": [
    "example-ui-image.png",
    "example-icon-image.png"
  ]
}
```

If a nearby third image is unrelated and the user does not connect it to this feedback, omit it.

### Replace Feedback And Images

If the user then says `Replace it with this feedback: the stop button does not respond` without relating either screenshot to the new issue:

```json
{
  "feedbackSkillVersion": "v2",
  "rawUserText": "The stop button does not respond",
  "issueTag": "请求失败/卡住/排队",
  "prefillPhotoTosUris": []
}
```
