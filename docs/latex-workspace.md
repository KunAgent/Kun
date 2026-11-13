# LaTeX papers in Work

Create a paper from the Work sidebar's new-document menu, import a folder or ZIP,
or open a `.tex` file in the file tree. A paper occupies one editor tab. Its file
picker switches between the project's `.tex`, `.ltx`, `.bib`, `.cls` and `.sty`
sources without creating extra tabs. Other Work documents and editor groups stay
available beside the paper.

The toolbar offers Source, Split and PDF views. Split becomes Source in a narrow
pane; the saved view returns when there is enough space. Cmd/Ctrl+backslash toggles
Source and PDF. The divider supports dragging and arrow keys. Compilation refreshes
retain the current PDF page and the offset within it, including while the PDF
pane is hidden or the interface is scaled.

## Saving and compiling

Cmd/Ctrl+S saves and, when enabled for the paper, compiles. The options menu also
offers a source-only save. Work's autosave preference controls automatic source
saves. Saving and PDF freshness have independent status indicators. Reactivating
a paper reconciles cached sources and its file list, and checks all project
inputs by digest without retransmitting the PDF. Late compiler/model responses
are accepted only by the session and request that started them.

Install a local TeX distribution containing `latexmk` and the chosen engine
(`pdflatex`, `xelatex` or `lualatex`). Kun checks PATH and standard macOS TeX
locations on the first compilation. Choose a custom tool directory if needed.
An optional `synctex` binary enables cursor-to-PDF positioning and double-click
navigation from PDF to source. Editing and saving work without these tools.

Use **Settings > Work > LaTeX papers > Set up TeX**, or the paper toolbar's
**Set up TeX** action, to inspect the detected programs and search paths. The
missing-tools preview links to the same environment dialog. Opening a paper
does not start a download or require an installed compiler.

The explicit **Install TinyTeX** action downloads the current official TinyTeX-1
release, verifies its published SHA-256 digest, and installs it in Kun's own
user-data tool directory. It configures latexmk, all three engines, recommended
LaTeX packages, CTeX and Fandol fonts. Existing TeX installations and system PATH
are preserved. Once installation and executable checks succeed, the managed
directory becomes available to every paper, including SyncTeX operations.

Progress, cancellation, failure details and retry remain available when the
dialog is reopened. Closing the dialog continues installation while Kun is
open; quitting Kun cancels it. An unsuccessful install never replaces the
previous managed installation. Unix systems need Perl and a tar implementation
with xz support. Automatic bundles support macOS Intel/Apple Silicon, Windows
x64, Linux x64/arm64 with glibc, and Linux x64 with musl. Other systems can use
the platform's official installation guide or select an existing tools directory.

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
Supplied `.bbl` bibliographies remain project inputs, including when no `.bib`
source is available. They are retained in imports, snapshots and source ZIPs.

Deleting an old main file moves its paper tab to a surviving main document.
When no main document remains, other source drafts are saved before closing
the tab; unresolved reviews must be handled first. Editing is held during the
file operation so a draft cannot be introduced after the preservation step.

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

Real toolchain integration coverage is in `src/main/services/latex/real-tex.integration.test.ts`.
It runs automatically when latexmk and the relevant local engine are detected;
otherwise those tests are reported as skipped. It covers a supplied `.bbl`,
real compiler failure, PDF retention, SyncTeX when available, and the Chinese
XeLaTeX template.

`KUN_TEST_REAL_TINYTEX=1 npx vitest run src/main/services/latex/toolchain-install.integration.test.ts`
downloads and installs the real toolchain into a temporary directory, compiles
both English and Chinese templates through the normal build service, and removes
the temporary tools. It does not change the installed app or system PATH.
