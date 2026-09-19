# Work workspace knowledge bases

Kun can mount a Work workspace on an individual Code thread as a read-only
knowledge base. The feature uses a PageIndex-inspired structural index rather
than embeddings or a vector database. Indexes are derived local data and can be
rebuilt at any time.

## Product model

- Work workspaces remain the source of truth. Mounting does not copy or move
  their documents.
- Mounts belong to a thread and are copied when that thread is forked.
- A mount stores a stable id, absolute root, display name,
  `source: write-workspace`, and `access: read-only`.
- A Code thread can mount at most eight non-overlapping roots. Its primary
  working directory cannot also be mounted as a knowledge base.
- Mount mutation and manual rebuild are rejected while the thread is running.

`additionalWorkspaces` and `knowledgeBases` are intentionally different:
additional workspaces extend normal filesystem/sandbox authority, while a
knowledge-base root never does. Knowledge-base content is available only
through the three read-only tools below. GUI project extra folders use
`additionalWorkspaces`, not knowledge-base mounts. Do not present "Add folder
to project" as knowledge-base mounting. Git, plan worktrees, and the default
shell stay on the primary workspace.

## Vectorless index

The indexer scans supported sources with fixed file, byte, page, entry, and
node limits. It ignores symlinks, hidden directories, VCS metadata, dependency
trees, generated output, unreadable files, and sources whose canonical path
escapes the mount root.

Supported sources:

- Markdown: `.md`, `.markdown`, `.mdx`
- Plain text: `.txt`
- PDF: `.pdf` (text layer only; no OCR in the Kun indexer)
- Word: `.docx`, plus `.doc` when local LibreOffice conversion is available
- Presentations: `.pptx`, plus `.ppt` when local LibreOffice conversion is available
- Spreadsheets: `.xls`, `.xlsx` (parsed directly with sparse SheetJS traversal)

Office sources use a 10 MiB per-file limit. Temporary lock files, disguised
container families, macro-enabled OOXML, malformed/encrypted packages, and
archive-limit violations are reported as unavailable documents. Missing
OfficeCLI affects Word and PowerPoint only; missing LibreOffice affects legacy
DOC/PPT only, so text, PDF, XLS, and XLSX sources continue to index.

The generated graph contains:

- root and directory nodes;
- document nodes;
- Markdown heading nodes with exact line ranges;
- plain-text paragraph nodes with exact line ranges;
- PDF page nodes with exact page numbers;
- Word section and paragraph-range nodes (paragraphs are canonical; pages are
  only optional rendering hints);
- presentation nodes with exact slide numbers;
- worksheet and bounded sparse cell-range nodes with normalized `Sheet!A1:C3`
  locations, formatted values, merge coverage, and formula annotations;
- Markdown and Wiki-link reference edges between indexed documents.

Node ids are deterministic hashes of structural source locations. A source
fingerprint is calculated from the bounded scan metadata. The index is stored
under Kun's data directory in `knowledge-indexes/`, never in the Work
workspace. Status is one of `pending`, `indexing`, `ready`, `stale`,
`unavailable`, or `error`. Concurrent requests for the same root share one
in-flight build.

Schema-v2 indexes reference bounded Office evidence under
`knowledge-artifacts/<mount-key>/`. Artifacts are keyed by the exact source
SHA-256, format, and extractor version, written atomically, reused across
rebuilds, and pruned only after a new index is published. `knowledge_read`
recomputes the current Office source SHA before serving a chunk; a mismatch
returns stale/unavailable instead of cached text and schedules a rebuild.

## Retrieval flow

```text
User mounts Work workspace on Code thread
  -> bounded canonical-path scan
  -> directory/document/section/page/slide/worksheet/range graph
  -> knowledge_catalog(query?)
  -> knowledge_browse(mount_id, node_id?)
  -> knowledge_read(mount_id, node_ids)
  -> bounded evidence with relative path + format-aware citation + source SHA
```

`knowledge_catalog` lists authorized mount ids and root node ids. An optional
query performs lightweight deterministic term ranking over node titles,
relative paths, and summaries; it does not create embeddings.

`knowledge_browse` returns a bounded page of child summaries and related graph
edges. The model chooses where to navigate next, which provides the
PageIndex-style reasoning loop.

`knowledge_read` accepts at most six authorized node ids and returns bounded
source evidence with a structural breadcrumb and an exact line, page, paragraph,
slide, or worksheet/A1 location.
Absolute roots are not returned to the model. Every result marks source text as
untrusted evidence, not executable instructions.

## Runtime and GUI boundaries

Kun owns contracts, persistence, indexing, authorization, tools, and HTTP
routes. The renderer only maps thread state and presents the picker/status UI.
The dynamic per-turn context includes mount names and ids after the immutable
system prefix, so changing mounts does not destabilize the shared cache prefix.

Renderer routes:

- `GET /v1/threads/{id}/knowledge-bases`
- `POST /v1/threads/{id}/knowledge-bases/{knowledgeBaseId}/reindex`
- `PATCH /v1/threads/{id}` with `knowledgeBases`

The Code composer picker is sourced from Work workspaces. It can add a new
directory to Work and mount it in one operation, shows index freshness, and
can switch to the matching Work workspace for source inspection.
Office status additionally reports usable, unavailable, and truncated document
counts, per-format totals, and bounded actionable diagnostics. Office evidence
cards open the cited source in the existing read-only Work preview.

The Code composer `@` menu also lists knowledge bases already mounted on the
active thread, in a separate group before workspace files and directories.
Selecting one inserts an explicit `@kb:"Name"` token in the user request. The
token is ordinary prompt text, so drafts, queued messages, retries, history,
and exports preserve it without a second persisted reference contract. Kun's
existing dynamic turn context maps the name to the authorized mount id and the
agent retrieves evidence through `knowledge_catalog`, `knowledge_browse`, and
`knowledge_read`.

The `@` menu does not mount new Work workspaces. Users add or remove mounts with
the knowledge-base picker while the thread is idle, then mention those mounts
in a request. A mention never becomes a file reference, never eagerly expands
knowledge documents into the prompt, and never grants generic file or sandbox
access to the knowledge root.

## Security invariants

1. Tool arguments contain mount/node ids, never arbitrary filesystem paths.
2. Every tool call reloads the owning thread and authorizes the mount id.
3. Source reads resolve both the mount and file through canonical paths and
   reject root escape, including symlink replacement after indexing.
4. Knowledge tools are `read-only`, automatic, local-only, and are advertised
   only when the active thread has mounts.
5. Knowledge roots are never added to the workspace sandbox or ordinary file
   tools.
6. Missing, stale, unreadable, oversized, or malformed sources degrade to
   status/diagnostics without granting broader access.
