# LaTeX papers in Work

Create a paper from the Work sidebar's new-document menu, import a folder or ZIP,
or open a `.tex` file in the file tree. A paper occupies one editor tab. Its file
picker switches between the project's `.tex`, `.ltx`, `.bib`, `.cls` and `.sty`
sources without creating extra tabs. Other Work documents and editor groups stay
available beside the paper.

The toolbar offers Source, Split and PDF views. Split becomes Source in a narrow
pane; the saved view returns when there is enough space. Cmd/Ctrl+backslash toggles
Source and PDF. The divider supports dragging and arrow keys.

## Saving and compiling

Cmd/Ctrl+S saves and, when enabled for the paper, compiles. The options menu also
offers a source-only save. Work's autosave preference controls automatic source
saves. Saving and PDF freshness have independent status indicators.

Install a local TeX distribution containing `latexmk` and the chosen engine
(`pdflatex`, `xelatex` or `lualatex`). Kun checks PATH and standard macOS TeX
locations on the first compilation. Choose a custom tool directory if needed.
An optional `synctex` binary enables cursor-to-PDF positioning and double-click
navigation from PDF to source. Editing and saving work without these tools.

New projects offer Chinese (`ctexart`), English (`article`) and blank templates.
Defaults live in Settings > Work. Each project's `.kun-latex.json` records its
main document, engine, bibliography, tool directory and compile-on-save setting.
When several main documents are discovered without an explicit main file, choose
one before compiling.

Compilation reads an immutable source snapshot in the application cache. The
owned-process guard supervises TeX and its descendants; cancellation, idle timeout
and app shutdown terminate the process tree. `latexmk` runs with argument arrays,
without project RC files or shell escape. Generated files stay outside the source
project. Build errors open the problem list and link to source lines. A failed
build retains the previous successful PDF and marks it as old.

## References and revisions

Type `\cite{` to complete keys from the project's bibliographies and existing
paper library. The References panel searches titles, authors, years and keys,
lists citation counts and missing entries, and inserts at the current source
cursor. New library entries are staged in the project's bibliography. Matching
DOIs reuse the existing key; unrelated key collisions receive a numeric suffix.

Use the selected-text revision field or the problem list's Kun repair action to
request a proposed change. Suggestions appear in Work's Review panel before they
are saved. Accepting saves and recompiles; rejecting an AI proposal writes no
files. Work assistant turns carry the main document, active source and current
diagnostics, and request proposals in a `kun-latex-edits` JSON fence. The renderer
validates source baselines before staging those suggestions. Changes made directly
on disk are also surfaced for review and cannot silently overwrite a local draft.

## Export and limits

PDF export first saves and compiles current source, then checks the source hash
again. A failed or stale build cannot export an old PDF. Source ZIP export keeps
project files and figures, excludes build products, and removes the local tool
directory from the exported manifest. BibTeX can also be copied separately.

Projects are limited to 100 MiB and 5,000 entries. Symbolic links and ZIP path
traversal are rejected. Sources larger than 1.5 MiB receive a read-only preview;
compilation still uses their complete bytes. PDF preview is limited to 32 MiB.
External source dependencies must be included inside the project directory.

## Implementation and verification

- Shared contracts: `src/shared/latex-project.ts` and `latex-bibliography.ts`.
- Native services: `src/main/services/latex/`, registered by
  `src/main/ipc/register-app-latex-ipc-handlers.ts`.
- Desktop preload: `src/preload/latex-api.ts`. Compilation IPC is not exposed by
  the remote-phone allowlist.
- Renderer state: `src/renderer/src/write/latex/`.
- Work components: `src/renderer/src/components/write/latex/`.

Run the LaTeX tests with `npx vitest run src/main/services/latex
src/renderer/src/write/latex src/shared/latex-project.test.ts
src/shared/latex-bibliography.test.ts`. Process tests use real owned child
processes; build orchestration fixtures provide a deterministic compiler. A real
TeX installation is needed to validate a particular paper's packages and fonts.
