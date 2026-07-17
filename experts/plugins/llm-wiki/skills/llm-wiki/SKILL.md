---
name: llm-wiki
description: "Build and maintain a personal knowledge base (wiki) using LLMs. Instead of RAG-style retrieval, the LLM incrementally compiles, cross-references, and maintains a persistent structured wiki from raw sources. Use when user wants to create a knowledge base, build a personal wiki, organize research notes, ingest documents into a structured wiki, or maintain a living knowledge repository."
description_zh: "用 LLM 增量构建和维护个人知识库 Wiki"
description_en: "Build a persistent personal wiki with LLM-maintained knowledge"
homepage: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
allowed-tools: Read,Write,Bash,Grep,Glob
---

# Karpathy LLM Wiki

A pattern for building personal knowledge bases using LLMs.

> Based on [Andrej Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

## The Core Idea

Instead of RAG (retrieve-on-every-query), the LLM **incrementally builds and maintains a persistent wiki** — a structured, interlinked collection of markdown files. When you add a new source, the LLM reads it, extracts key information, and integrates it into the existing wiki — updating entity pages, revising topic summaries, noting contradictions, and strengthening the evolving synthesis.

**The wiki is a persistent, compounding artifact.** Cross-references are already there. Contradictions have been flagged. Synthesis reflects everything you've read. It gets richer with every source and every question.

You never write the wiki yourself — the LLM writes and maintains all of it. You're in charge of sourcing, exploration, and asking the right questions.

## Architecture (Three Layers)

### 1. Raw Sources
Your curated collection of source documents — articles, papers, images, data files. These are **immutable**. The LLM reads from them but never modifies them. This is your source of truth.

### 2. The Wiki
A directory of LLM-generated markdown files — summaries, entity pages, concept pages, comparisons, overview, synthesis. The LLM owns this layer entirely: creates pages, updates them when new sources arrive, maintains cross-references, keeps everything consistent. **You read it; the LLM writes it.**

### 3. The Schema
A configuration document (this skill) that tells the LLM the wiki's structure, conventions, and workflows. You and the LLM co-evolve this over time.

## Operations

### Ingest
User drops a new source. The LLM:
1. Reads the source and discusses key takeaways
2. Writes a summary page in the wiki
3. Updates the index
4. Updates relevant entity and concept pages across the wiki
5. Appends an entry to the log

A single source may touch 10-15 wiki pages. Prefer ingesting one source at a time for quality.

### Query
Ask questions against the wiki. The LLM:
1. Reads `index.md` to find relevant pages
2. Reads those pages and synthesizes an answer with citations
3. **Good answers get filed back into the wiki as new pages** — comparisons, analyses, connections should be persisted, not lost in chat history

### Lint (Health Check)
Periodically health-check the wiki. Look for:
- Contradictions between pages
- Stale claims superseded by newer sources
- Orphan pages with no inbound links
- Important concepts mentioned but lacking their own page
- Missing cross-references
- Data gaps that could be filled with a web search

## Default Location

The wiki lives at a **user-level** path so it's accessible from any workspace or conversation:

```
~/.workbuddy/wiki-knowledge/
```

This is the default. The LLM should:
1. **Always check `~/.workbuddy/wiki-knowledge/` first** when the user mentions their wiki, regardless of the current workspace.
2. If the directory exists and contains `WIKI-SCHEMA.md`, use it directly — no need to ask the user for a path.
3. Only ask for a custom path if the user explicitly wants a separate wiki.

## Getting Started

When a user wants to create a wiki, follow these steps:

### Step 1: Initialize Structure
Create at `~/.workbuddy/wiki-knowledge/` (or a user-specified path):
```
wiki-knowledge/
├── raw/              # Immutable source documents
│   └── assets/       # Downloaded images
├── wiki/             # LLM-maintained markdown files
│   ├── index.md      # Content catalog
│   └── log.md        # Chronological operation log
└── WIKI-SCHEMA.md    # Schema & conventions (co-evolve with user)
```

### Step 2: Create index.md
A catalog of everything in the wiki — each page listed with a link, a one-line summary, and metadata (date, source count). Organized by category. The LLM updates it on every ingest.

### Step 3: Create log.md
Append-only chronological record. Each entry format:
```markdown
## [YYYY-MM-DD] operation_type | Title
Brief description of what was done.
```
Use consistent prefixes so it's parseable with grep:
```bash
grep "^## \[" log.md | tail -5
```

### Step 4: Create WIKI-SCHEMA.md
A configuration file describing:
- Directory structure and conventions
- Page format templates
- Cross-referencing rules
- Domain-specific categories
- Workflows for ingest/query/lint

Customize this with the user for their specific domain.

## Page Format Template

```markdown
---
title: Page Title
type: entity | concept | source-summary | comparison | synthesis
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: [list of source filenames]
tags: [relevant tags]
---

# Page Title

Content here. Use [[wiki-links]] for cross-references.

## See Also
- [[related-page-1]]
- [[related-page-2]]
```

## Use Cases

| Domain | Raw Sources | Wiki Pages |
|--------|------------|------------|
| **Personal** | Journal entries, articles, podcast notes | Goals, health tracking, self-improvement |
| **Research** | Papers, articles, reports | Entities, concepts, evolving thesis |
| **Book reading** | Chapter notes | Characters, themes, plot threads |
| **Business** | Slack threads, meeting transcripts, docs | Internal knowledge base |
| **Competitive analysis** | Company reports, news | Competitor profiles, comparisons |
| **Course notes** | Lecture notes, readings | Topic summaries, concept maps |

## Tips

- **Obsidian** works great as the wiki viewer — graph view shows connections, Dataview plugin queries frontmatter metadata
- **The wiki is just a git repo of markdown files** — version history, branching, and collaboration for free
- **Marp** can generate slide decks from wiki content
- **Web Clipper** (Obsidian plugin) converts web articles to markdown for easy source ingestion
- **Download images locally** for persistence — set a fixed attachment directory

## Important Principles

1. **Raw sources are immutable** — never modify source documents
2. **The LLM owns the wiki** — users read, LLM writes and maintains
3. **Knowledge compounds** — every ingest and query enriches the wiki
4. **File good answers back** — don't let valuable analysis disappear into chat
5. **Regular lint passes** — keep the wiki healthy as it grows
