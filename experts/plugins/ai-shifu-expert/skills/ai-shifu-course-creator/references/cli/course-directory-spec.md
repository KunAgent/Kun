# Course Directory Specification

## Directory Structure

```
<course>/
  README.md            # Course metadata (title from first heading)
  course-description.md # SEO/listing description mapped to the platform description field
  course-prompt.md     # Course-level prompt (AI role and teaching style)
  course-config.json   # Course-level attributes (model/price/TTS/Ask/…) — round-tripped so import doesn't reset them
  shifu-import.json    # Generated import file (output of build)
  structure.json       # Chapter structure + per-lesson access/hidden (optional, for multi-chapter courses)
  .shifu-sync.json     # Auto-maintained by pull + version-aware writes (update-lesson/update-meta/import): local↔cloud version link
  lessons/
    lesson-01.md       # Teaching Prompt (MarkdownFlow)
    lesson-02.md
    ...
  assets/              # Image assets (optional)
    image-manifest.json  # Auto-maintained by upload-image: local → remote → alt
    raw/                 # Recommended location for the author's original images
```

## assets/

The `assets/` directory is created and maintained by `shifu-cli.py upload-image --course-dir <dir>`. It exists to give the course a stable record of which images have been uploaded, what they convey, and what their `res.ai-shifu.cn` URLs are.

`image-manifest.json` schema:

```json
{
  "images": [
    {
      "local": "assets/raw/gradient-descent.heic",
      "remote": "https://res.ai-shifu.cn/abcd…",
      "alt": "梯度下降三步示意",
      "uploaded_at": "2026-05-23T08:42:31Z",
      "bytes": 612345,
      "original_bytes": 4521000,
      "mime": "image/jpeg",
      "filename": "gradient-descent-1a2b3c4d.jpg"
    },
    {
      "source_url": "https://example.com/diagram.png",
      "remote": "https://res.ai-shifu.cn/efgh…",
      "alt": "Transformer 注意力计算流程",
      "uploaded_at": "2026-05-23T08:45:02Z"
    }
  ]
}
```

Field reference:

- `local` (file uploads): path relative to `<course-dir>` when possible, otherwise absolute. Acts as the dedup key — uploading the same path again updates the entry rather than appending.
- `source_url` (URL uploads): the original remote URL provided to `--url`. Acts as the dedup key for URL-based uploads.
- `remote`: the platform OSS URL produced by upload. This is the value that should appear in Teaching Prompts.
- `alt`: description supplied via `--alt`. Not auto-rendered into MarkdownFlow — the authoring LLM still writes a contextual alt.
- `uploaded_at`: UTC ISO 8601 timestamp.
- `bytes` / `original_bytes` / `mime` / `filename` (file uploads only): book-keeping for the preprocessed payload that was actually sent.

`assets/raw/` is a recommendation, not enforced: store originals there so the manifest's `local` paths are stable across machines. The `build` command ignores `assets/` entirely.

## .shifu-sync.json

Auto-maintained by `pull` and the version-aware write commands
(`update-lesson` / `update-meta` / `import`). **Do not hand-edit.** It records
the link between this local directory and the cloud course so pushes behave like
`git push` (compare baseline before uploading) rather than blindly overwriting.

Schema (abridged):

```json
{
  "schema_version": 1,
  "shifu_bid": "a1b2c3…",
  "base_url": "https://app.ai-shifu.cn",
  "course": {"revision": 42, "name": "…", "description": "…", "updated_at": "…", "updated_user_bid": "…"},
  "lessons": [
    {"file": "lessons/lesson-01.md", "outline_bid": "9a8b…", "name": "…",
     "parent_bid": "ch_001", "revision": 1187, "is_chapter": false,
     "content_sha256": "…"},
    {"file": null, "outline_bid": "ch_001", "name": "第一章", "parent_bid": "",
     "revision": null, "is_chapter": true}
  ],
  "last_pull_at": "…", "last_push_at": "…"
}
```

The per-lesson `revision` is the optimistic-locking baseline (the version at
last pull/push) — how `status` detects "behind" and how a push detects a
concurrent edit. `content_sha256` lets `status` tell whether the local file was
edited since the last sync. See
`references/cli/cli-reference.md#version-sync-pull--status` for the workflow.

## Lesson Files

When `structure.json` is not present, `build` auto-discovers only `lesson-*.md` files (e.g., `lesson-01.md`, `lesson-02.md`) and ignores other filenames. When `structure.json` is present, lesson files are taken from `chapters[].lessons[].file` and any filename is accepted as long as it exists.

## course-description.md

Contains the learner-facing SEO/listing description for the course. Path A and
Author Only outputs must generate this file from the course topic, target
learners, and concrete learning outcomes; do not include author-side workflow
notes.

The `build` and `import --course-dir` commands map this file to
`shifu.description` in `shifu-import.json`, which the CLI sends to the platform
`description` field. Resolution order is:

1. `--description`
2. `<course-dir>/course-description.md`
3. empty string

Old course directories without `course-description.md` remain valid; they build
with an empty platform description unless an explicit description flag is used.
`pull` writes the current cloud description back to this file, and
`update-meta --course-dir` pushes this file when it has a local content change;
`update-meta --description --course-dir` also refreshes the file after a
successful platform update.

## course-prompt.md

Defines the AI engine's role, teaching style, and interaction rules at the course level. The `build` command reads this file and populates `shifu.course_prompt` in the import JSON automatically (which the CLI maps to the platform API field `system_prompt` on import).

Authoring rules and a fillable template live in `../course-prompt.md`.

Note: MarkdownFlow files do not support HTML comments (`<!-- -->`). The parser discards them entirely, so the AI engine never sees them. Write instructions as plain text directly in the Course Prompt content.

## structure.json

Defines multi-chapter course structure. If this file exists, `build` uses it to organize lessons into chapters; otherwise all lessons are placed under a single auto-generated chapter.

Schema:

```json
{
  "chapters": [
    {
      "title": "Chapter Title",
      "lessons": [
        {"file": "lesson-01.md", "title": "Lesson Title", "access": "guest", "hidden": false},
        {"file": "lesson-02.md", "title": "Another Lesson Title", "access": "normal", "hidden": false}
      ]
    }
  ]
}
```

Field reference:

- `chapters[].title` (required): Chapter display name
- `chapters[].lessons[]` (required): Array of lesson objects
- `chapters[].lessons[].file` (required): Filename in the `lessons/` directory (must exist)
- `chapters[].lessons[].title` (required): Lesson display name.
- `chapters[].lessons[].access` (read-only reference): learning permission — `guest` = 无需登录 (anyone), `trial` = 试看 (needs login), `normal` = 需付费 (paid). Written by `pull` so the agent can see each lesson's permission. **`build`/`import` do NOT push it** — the skill does not manage attributes by default; the platform keeps each lesson's permission (the backend preserves any field a write omits). To change a permission, use `set-access` (below).
- `chapters[].lessons[].hidden` (read-only reference, bool): whether the lesson is hidden. Same as `access`: written by `pull`, not pushed by build/import.

## course-config.json

A **read-only snapshot** of the course-level attributes (model / price / TTS /
Ask / keywords / …), written by `pull` so the agent can see the current settings.
**`build`/`import` do NOT send it.** The skill does not push course attributes by
default — the backend preserves any attribute a write leaves out, so iterating
content never resets model/price/TTS/Ask. The course **name** lives in
`README.md`, the SEO **description** in `course-description.md`, and the
**system prompt** in `course-prompt.md`.

The exception is an explicit listening-mode update: `set-tts --course-dir`
refreshes this snapshot after changing `tts_enabled`. It still does not make
`build` or `import` push course-level attributes.

```json
{
  "model": "", "temperature": 0.3, "price": 0, "keywords": [], "avatar": "",
  "use_learner_language": false,
  "tts_enabled": false, "tts_provider": "minimax", "tts_model": "", "tts_voice_id": "",
  "tts_speed": 1.0, "tts_pitch": 0, "tts_emotion": "",
  "ask_enabled_status": 5101, "ask_model": "", "ask_temperature": 0.0,
  "ask_system_prompt": "", "ask_provider_config": {}
}
```

To change a single lesson's permission, use
`shifu-cli.py set-access <shifu_bid> <outline_bid> --access guest|trial|normal [--hidden true|false] [--course-dir <dir>]`
(passing `--course-dir` also updates the `structure.json` reference). To change
course listening mode, use
`shifu-cli.py set-tts <shifu_bid> --enabled true|false [--course-dir <dir>]`.
Other course-level attributes are changed in the platform editor.
