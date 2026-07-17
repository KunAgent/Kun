# CLI Reference

All commands use `{skillDir}/scripts/shifu-cli.py`. Prefix every call with:

```bash
python3 {skillDir}/scripts/shifu-cli.py <command>
```

## Authentication

The token persists in `{skillDir}/.env` and is valid for **7 days**, with each
successful API call refreshing the expiry (sliding window — an active user never
expires).  Before every operation that needs a token, run the one-shot check:

```bash
verify                         # exit 0 = valid, 1 = expired, 2 = unknown
```

When `verify` returns 1, run the SMS login once:

```bash
# Step 1: Send SMS verification code (once per session — see below)
login --phone 13800138000

# Step 2: Complete login with the 4-digit code
login --phone 13800138000 --sms-code 1234
```

The CLI always talks to `https://app.ai-shifu.cn`. To skip the SMS login, set
`--token` / `SHIFU_TOKEN` directly.

### Agent Login Flow

**Gate: run `shifu-cli.py verify` first.** Exit 0 → skip login entirely; exit 1
→ run the flow below **once**; exit 2 → retry later, do NOT trigger a new login.

**Hard constraint — one phone number = one SMS send per login session.**  Each
phone number is capped at **5 SMS codes per day**.  Sending a second SMS when the
first is still in transit wastes a slot and risks locking the user out.  The
agent MUST:
- Collect the phone number → send `login --phone <phone>` **exactly once**.
- If the user asks "didn't receive / resend", reply "验证码在 60 秒内到达，请稍等" —
  do NOT resend unless **3 consecutive wrong codes** have been entered.
- After the 3rd consecutive wrong code, send `login --phone <phone>` one more
  time (this is the final SMS for this session).

Fixed flow: verify → (only if needed) ask for phone → send code → ask for SMS
code → complete. Run the steps in order. Do not ask anything else.

Do not ask anything else. No status checks ("have you signed up / logged in
before?"), no readiness or intent confirmations ("ready to start?", "I'll
provide my phone"), no acknowledgment pauses, no recaps between steps. Each turn
collects exactly the next value (phone, then SMS code), nothing else. The
Step 1 flow preview is a one-shot heads-up, not a confirmation prompt — do not
wait for the user to acknowledge it before asking for the phone.

Steps:

1. In a single turn, give the user a one-line preview of the full flow and then
   immediately ask for the phone number. Cover all of these in the preview:
   (a) SMS login, no password; (b) a 4-digit code will be sent to the phone;
   (c) the user replies with the code in the next turn; (d) on success the token
   is saved locally and login is complete; (e) new phone numbers auto-create an
   account on first use. Keep it brief — one or two sentences total — then ask
   for the phone in the same reply.
2. Send SMS code **once**:
   `python3 {skillDir}/scripts/shifu-cli.py login --phone <phone>`
3. Ask the user for the 4-digit verification code they received.
4. Complete login:
   `python3 {skillDir}/scripts/shifu-cli.py login --phone <phone> --sms-code <4-digit-code>`
5. Token is automatically saved — proceed with the requested operation.

**Error → agent behavior quick reference:**

| What happened | Agent response |
|---|---|
| `verify` exit 0 | Token valid — continue, no login |
| `verify` exit 1 | Run the SMS flow above **once** |
| `verify` exit 2 | Network issue — retry `verify` later |
| login returned "SMS sent" | Wait for user to provide code; do NOT resend |
| login returned "smsSendTooFrequent" | Wait 60 s then retry; do NOT send the phone again |
| login returned sms code error (1st or 2nd time) | Ask user to re-enter code; do NOT resend SMS |
| login returned sms code error (**3rd** consecutive time) | Re-send `login --phone <phone>` to get a new code |
| Any API call returned code 1005 (token expired) | Run `verify` → login flow |

**Token persistence.** The login step writes `SHIFU_TOKEN=<jwt>` into
`{skillDir}/.env`. Once saved, `verify` is the gate — the token stays valid for
7 days with sliding refresh. If the token expires (error codes `1001` / `1004`
/ `1005`), re-run the login flow — the `.env` is overwritten in place.

Always use CLI commands. Never make raw HTTP/API calls directly.

## Query Commands

```bash
list                                          # List all courses
show <shifu_bid>                              # Show course details + outline tree
show <shifu_bid> <outline_bid>                # Read a lesson's Teaching Prompt
history <shifu_bid> <outline_bid>             # Teaching Prompt revision history
export <shifu_bid> [-o file.json]             # Export course as JSON
```

`show` (without `outline_bid`), `create`, `import`, and `publish` all print a `Verification URLs:` block. Lines included depend on the command: `publish` and `show` add a `Published URL:` line (the public student-facing address — `<base>/c/<bid>` without `preview=true`); `create` and `import` omit it because the course is not yet published. Each URL is followed by a one-line `# ...` Chinese hint that explains the click jumps to AI 师傅 and what the link is for; it mentions AI 师傅 credit consumption only when the linked action can consume credits. Per-lesson preview URLs are no longer printed — if you need one, use `show <shifu_bid>` to find the `outline_bid` and build `<base>/c/<bid>?preview=true&lessonid=<outline_bid>` on demand. Copy printed URLs as-is when reporting; never reconstruct them from a template.

## Analytics Query

```bash
analytics-query <shifu_bid> --dsl '<json>'        # Inline DSL body
analytics-query <shifu_bid> --dsl-file query.json # DSL body from a JSON file
```

Runs a DSL query against the creator-analytics endpoint and prints the full JSON response (success rows or business error code) to stdout. The CLI handles authentication headers automatically — never call the endpoint directly.

The `shifu_bid` positional argument is injected into the body; if the DSL JSON already carries a `shifu_bid`, it must match the positional argument.

Exit codes:
- `0` — API responded with `code == 0` (the response carries `data.columns` / `data.rows`).
- `1` — transport failure, JSON parse failure, or business error code (e.g. `11001` no access to course, `11002`-`11007` invalid DSL, `1001` / `1004` / `1005` token expired or missing).

The full response is always printed to stdout regardless of exit code, so the agent can read the error code and either fix the DSL or guide the user to re-login. The CLI deliberately does not exit before printing analytics business errors.

Use this command in conjunction with the analytics references in `references/analytics/` — never construct raw HTTP calls.

## Version Sync (pull / status)

The platform draft is the single source of truth — both draft and published
versions carry an auto-incrementing `revision`. These commands keep a local
course directory and the cloud draft version-consistent, like `git pull` /
`git status`, so edits never silently overwrite a change another editor pushed.

```bash
pull <shifu_bid> --course-dir ./course-a/ [--force]   # Cloud -> local, writes .shifu-sync.json
status --course-dir ./course-a/ [--exit-code]         # Compare local vs cloud revisions
```

- `pull` fetches the course detail, outline tree, every lesson's MarkdownFlow,
  and the course-level draft revision, writes them into the course directory
  (`README.md`, `course-description.md`, `course-prompt.md`,
  `lessons/lesson-NN.md`, `structure.json`),
  and records the cloud `revision` of each lesson + the course in
  `<course-dir>/.shifu-sync.json`. Any local file that diverges from the
  incoming cloud content is backed up to `<file>.local-<ts>.bak` first (unless
  `--force`).
- `status` reads `.shifu-sync.json`, then reports per lesson: **behind** (cloud
  revision advanced past the local baseline — run `pull`), **locally modified**
  (the local file changed since last sync — will be pushed), **new on server**,
  and **deleted on server**, plus a course-meta behind flag. `--exit-code`
  returns non-zero when anything diverged (handy for agent scripting).

`.shifu-sync.json` is **auto-maintained — do not hand-edit.** It is the local↔cloud
version link (shifu_bid + per-lesson outline_bid + revision + course revision).

**Canonical workflow:** `pull` → edit locally → `status` → `update-lesson` /
`import` (push) → `publish`.

**Exit-code convention** for the version-guarded write commands
(`update-lesson`, `update-meta`, `import` when given `--course-dir`):
`0` success · `2` conflict auto-pulled (redo on the new baseline) · `1` hard error.

## Create Commands

```bash
create --name "Title" [--description "Desc"]
add-chapter <shifu_bid> --name "Chapter Name"
add-lesson <shifu_bid> --name "Name" --teaching-prompt-file lesson.md --parent-bid <chapter_bid>
```

## Update Commands

```bash
update-meta <shifu_bid> [--name "..."] [--description "..."] [--course-prompt-file prompt.md] [--course-dir ./course-a/]
update-lesson <shifu_bid> <outline_bid> --teaching-prompt-file lesson.md [--course-dir ./course-a/]
rename-lesson <shifu_bid> <outline_bid> --name "New Name"
reorder <shifu_bid> --order bid1,bid2,bid3
set-access <shifu_bid> <outline_bid> --access guest|trial|normal [--hidden true|false] [--course-dir ./course-a/]
set-tts <shifu_bid> --enabled true|false [--course-dir ./course-a/]
```

`update-meta` sends only the content fields you pass (`--name` / `--description`
/ `--course-prompt-file`), plus a locally modified `course-description.md` when
`--course-dir` is supplied; it does **not** touch course
attributes (model / price / TTS / Ask / …) — the backend preserves any field
left out. When `--course-dir` is supplied, a successful description update
writes `course-description.md` and records the new course metadata baseline in
`.shifu-sync.json`. `rename-lesson` likewise changes only the name and no longer
resets the lesson's learning permission.

`set-access` sets one lesson's **learning permission** (`guest` = 无需登录 /
`trial` = 试看·需登录 / `normal` = 需付费) without re-importing; it sends only
`type` (+ `is_hidden` when `--hidden` is given), and the backend leaves the
lesson's other fields untouched. With `--course-dir` it also writes the value
into the `structure.json` reference.

`set-tts` enables or disables course listening mode without re-importing; it
sends only `tts_enabled` and leaves provider/model/voice/speed/pitch/emotion
unchanged. With `--course-dir` it refreshes `course-config.json` and records the
new course revision in `.shifu-sync.json`.

`update-lesson`, `update-meta`, and `set-tts` are version-aware when given `--course-dir`
(a directory with a `.shifu-sync.json` from `pull`):

- `update-lesson` uses the **recorded baseline** revision for that outline (its
  revision at last pull/push) as `base_revision`, so a concurrent edit by
  another editor is actually detected. Without `--course-dir` it falls back to
  the legacy behavior of taking the current cloud head as the baseline
  (degraded — concurrent edits are not caught). On success it writes the new
  revision back to the manifest and keeps the local lesson file in lockstep.
- `update-meta` and `set-tts` have no server-side lock, so they compare the cloud
  course-level revision against the manifest baseline before writing; any cloud
  advance is treated conservatively as a conflict.

**On conflict** these commands auto-pull the cloud copy over local (backing up
your un-pushed change to `<file>.conflict` for a lesson, or
`.shifu-meta.conflict.json` for meta — your work is never lost), print who
changed it and when, and exit `2`. Re-apply your edit on the freshly pulled
baseline and run the command again. Without `--course-dir`, `update-lesson`
still sends the cloud-head `base_revision` and the server may reject the save
with a raw conflict response (no auto-recovery).

## Delete Commands

```bash
delete-lesson <shifu_bid> <outline_bid>
```

## Bulk Import

```bash
# Flat JSON import
import <shifu_bid> --json-file course.json
import --new --json-file course.json

# One-step build + import from course directory
import <shifu_bid> --course-dir ./course-a/ [--title "..."] [--description "..."] [--chapter-name "..."]
import --new --course-dir ./course-a/ [--title "..."] [--description "..."] [--chapter-name "..."]

# Local build only (offline, generates shifu-import.json)
build --course-dir ./course-a/ [-o shifu-import.json] [--title "..."] [--description "..."] [--chapter-name "..."]
```

The `build` command works entirely offline — it reads the course directory's Teaching Prompts (one MarkdownFlow file per lesson under `lessons/`), the Course Prompt, and the SEO course description, then produces `shifu-import.json` without any network calls. The `import --course-dir` option combines build + import in one step. Description resolution order is `--description` -> `<course-dir>/course-description.md` -> empty string.

**Course attributes are not pushed by default.** The skill manages course
*content*; *attributes* (each lesson's learning permission / hidden state, and
course-level model/price/TTS/Ask/…) are left to the platform. `build`/`import`
send only content (lesson MarkdownFlow + course name/description/system prompt),
and the backend uses **PATCH semantics** — any field a write omits is preserved.
So `update-lesson` (content only) and `update-meta` (only the `--name` /
`--description` / `--course-prompt-file` you pass, plus a locally modified
`course-description.md` with `--course-dir`) never
touch attributes.

`pull` still writes the attributes into `structure.json` (`access`/`hidden`) and
`course-config.json` as a **read-only reference** for the agent. To change an
attribute, do it explicitly: `set-access` for a lesson's permission, `set-tts`
for course listening mode, or the platform editor for other course-level
settings.

> **Iterating an existing course:** prefer the non-destructive granular commands
> — `pull → update-lesson / add-lesson / delete-lesson / reorder / set-access / set-tts`.
> The destructive whole-course `import` recreates every outline, so a recreated
> lesson gets the platform default permission; use `import --new` for brand-new
> courses, not to iterate an existing one.

**Version-aware import.** When re-importing into an existing course with a
`.shifu-sync.json` (`import <shifu_bid> --course-dir ...`), the CLI first checks
the cloud course-level revision against the manifest baseline; if another editor
advanced it, the whole local tree is backed up to `.conflict-backup-<ts>/`, the
cloud copy is pulled over local, and the command exits `2` (re-apply, then
re-run). After a successful import the manifest is re-seeded via an automatic
`pull` so subsequent edits stay version-tracked.

> **Note (Phase 1):** `import` is still destructive — it deletes and recreates
> every outline, so all `outline_bid`s are regenerated on each import (per-lesson
> server history does not carry over). For incremental, bid-stable edits prefer
> `pull` → `update-lesson`. A non-destructive diff import (`--sync`) is planned.

Build behavior:

- **Course title** resolution order: `--title` CLI arg -> first heading in `README.md` -> directory name
- **Course description** resolution order: `--description` CLI arg -> `course-description.md` -> empty string
- **Chapter structure**: if `structure.json` exists, generates multi-chapter structure per its definition; otherwise creates a single chapter (named via `--chapter-name` or defaults to course title) containing all `lesson-*.md` files in sorted order
- **Lesson title** resolution order: `title` field in `structure.json` -> filename derived (e.g., `lesson-01.md` -> "Lesson 01")

## Image Upload

```bash
# Local file: preprocessed locally (max side 2048 px, ≤ 2 MB, JPEG q=85 / PNG when alpha)
upload-image --file <local-path> [--course-dir <dir>] [--alt "<description>"]

# Remote URL: backend downloads and re-hosts; no local preprocessing
upload-image --url <http(s)-url> [--course-dir <dir>] [--alt "<description>"]
```

Stdout is **one line** — the resulting `https://res.ai-shifu.cn/<uuid32>` URL. Diagnostic / manifest messages go to stderr, so a shell pipeline can capture the URL cleanly:

```bash
URL=$(python3 scripts/shifu-cli.py upload-image --file diagram.png --course-dir ./my-course/ --alt "Transformer 单层结构")
```

Behavior:

- `--file`: opens with Pillow (HEIC/HEIF via `pillow-heif`), corrects EXIF orientation, downscales to longest-side 2048 px, recompresses JPEG until ≤ 2 MB; transparent images output PNG. Non-image inputs (e.g. `.pdf`, `.txt`) raise an error in the preprocessing stage and exit with code 1.
- `--url`: posts directly to `/api/shifu/url-upfile`; the backend validates the response is `image/*` and re-hosts the file.
- `--course-dir`: when provided, an entry is upserted into `<course-dir>/assets/image-manifest.json` keyed by `local` (for file uploads) or `source_url` (for URL uploads). Re-uploading the same path updates the entry rather than appending.
- `--alt`: short description of what the image conveys; stored in the manifest for review and for later authoring of MarkdownFlow alt text. The LLM should still write a context-appropriate alt when embedding the image — `--alt` is the source of truth, not the final rendered text.
- `--no-process` (debug only): skip preprocessing and upload bytes as-is. Use only when investigating a backend issue; will fail for HEIC and oversize files.

Dependencies: `Pillow`, `pillow-heif`. First-run failures suggest `pip install -r scripts/requirements.txt`.

For the embedding rules once you have a URL, see `references/markdownflow.md#images`.

## State Management

```bash
publish <shifu_bid>       # Publish course (makes it live)
archive <shifu_bid>       # Archive course
unarchive <shifu_bid>     # Restore archived course
```

## CLI Output & Encoding

### Known issue: Chinese characters garbled in agent environments

When running CLI commands (especially `list` and `show`) from an agent's Bash tool, Chinese characters in stdout may appear garbled (mojibake) even with `PYTHONIOENCODING=utf-8` set. This is caused by the agent's subprocess pipe not inheriting the correct locale settings.

**Recommended workaround** — write JSON output to a UTF-8 file, then read it with the agent's file-reading tool:

```bash
# Instead of reading garbled stdout directly:
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '<json>' > /tmp/shifu_result.json
# Then read /tmp/shifu_result.json with the agent's file reader
```

For `list` and `show`, which output formatted tables (not JSON), pipe through a JSON serialization helper or redirect to file:

```bash
python3 -c "
import subprocess, json, sys
result = subprocess.run(
    ['python3', 'scripts/shifu-cli.py', 'show', '<bid>'],
    capture_output=True, text=True, encoding='utf-8'
)
print(result.stdout)
" > /tmp/shifu_show.txt
```

### For analytics-query and credit-detail

These already output JSON via `json.dumps(ensure_ascii=False)`, so they work correctly when redirected to a file. The garbling only affects the pipe encoding — the JSON data itself is UTF-8.

### Token persistence

The token is saved to `{skillDir}/.env` after a successful login. Subsequent commands automatically read it. If the token expires (error codes `1001` / `1004` / `1005`), re-run the login flow — the token file is overwritten in place.
