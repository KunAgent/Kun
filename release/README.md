# Release notes

Each `release-v<version>.md` file is the curated note for one stable release.
CI publishes it as the GitHub release body (`scripts/prepare-ci-release-notes.cjs`),
and the desktop app bundles it for the dialog shown the first time Kun opens
after an update (`src/shared/release-notes-summary.ts`).

The dialog reads the structure, so keep this shape:

- `# Kun <version>`, then a one-paragraph summary. The dialog shows it as the intro.
- `## ✨ 新功能`: one bullet per feature, written as `- **Title**: description`.
  The first three named bullets become highlights, and the next four become
  "also updated" tags. Put a catch-all bullet such as `**其他**` last.
- `## 🐛 修复与改进`: one bullet per fix, in the same `- **Title**: description` form.
  The first sentence of each description is shown.
- `## 更新方式` and other install notes are skipped.
- `---`, then `## English`. Use the same order: features first, then a
  `### Fixes and improvements` heading, or a flat list with the same number of
  bullets as the Chinese sections.
