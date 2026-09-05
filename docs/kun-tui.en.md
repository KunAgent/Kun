# Kun Terminal UI (TUI)

After installing the Kun desktop app, run `kun` in a new terminal to enter the
TUI. `kun tui` is an exact alias. The interface uses
`@earendil-works/pi-tui` in inline mode and never switches to the terminal's
alternate screen, so the transcript remains in native scrollback after exit.

## Installation and release forms

Kun desktop packages include the complete TUI and runtime. Install the desktop
app to use `kun` / `kun tui`; no separate Node.js or TUI download is needed.
Starting with 0.3.8, Stable and Daily no longer build or publish standalone TUI
archives or advance the standalone update manifest. The bundled TUI updates
with the desktop app.

Existing historical archives and user data are not deleted. Users of the
0.3.7 standalone archive need the desktop app for 0.3.8 and later versions;
the old `kun update` command does not install a GUI package. Real GUI upgrades,
signing, artifact integrity, and public update-feed validation remain required.

The GUI and TUI use the same local HTTP/SSE protocol and persisted data, but
they no longer share one long-lived background Runtime by default. A normal
GUI or TUI owns the Runtime it starts, and only one owner may occupy a
`(canonical data directory, runtime flavor)` slot. When that owner exits, its
Runtime stops; the next client still reads the same threads, settings, memory,
usage, and model connections through Service Manager.

## Startup and the client-owned runtime

```bash
# Use the GUI-configured data dir, falling back to ~/.kun/data without GUI settings
kun

# Equivalent alias and common options
kun tui --workspace "$PWD" --continue
kun tui --thread <thread-id>

# Attach to a Runtime already owned by the GUI or another client
kun --no-start

# Start a fully independent TUI Runtime (separate threads, memory, and settings)
KUN_MANAGER_CONTROL_DIR="$HOME/.kun/tui-control" \
KUN_MANAGER_SETTINGS_PATH="$HOME/.kun/tui-settings.json" \
KUN_DATA_DIR="$HOME/.kun/tui-data" \
kun tui
```

Default TUI startup elects under the data-directory/flavor lock and Manager
fence, creates the token, chooses the port, and starts a Runtime owned by that
TUI session. Discovery records its instance ID, PID, owner, version, start time,
loopback URL, and log path. If the same slot already has a live or starting GUI,
another TUI, or a foreground `kun serve` owner, startup reports an actionable
conflict; it does not attach to, replace, or stop that owner. The default
Manager profile binds one canonical data directory, while production and
development flavors retain independent slots.

On `/quit`, terminal or signal exit, initialization failure, and every other
command exit, the TUI stops and waits for only its exact owned Runtime. Service
Manager stays alive across ordinary TUI exits as the lightweight election and
canonical data plane, but does not execute Agent turns itself. The GUI follows
the same ownership rule: real Quit stops its Runtime, while hiding, close to
tray, or macOS residency without a window does not. A default TUI therefore
still conflicts while the GUI is in the tray. The GUI restart control restarts
only that GUI's Runtime.

`--url` and `--no-start` are explicit non-owning connections. When the GUI owns
the default Runtime, run `kun tui --no-start` to share its threads and settings.
The TUI neither starts nor stops that Runtime, and the connection may end when
the owner exits. To let the GUI and TUI each own a Runtime, isolate
`KUN_MANAGER_CONTROL_DIR`, `KUN_MANAGER_SETTINGS_PATH`, and `KUN_DATA_DIR`
together as shown above; changing only the port or data directory does not form
a fully isolated Manager profile. During the first upgrade, the launcher may
gracefully retire one authenticated, exact legacy `launchMode: shared` daemon
without client-owner metadata in the same canonical data directory. Ambiguous
identity fails closed and never scans or terminates other data directories or
user processes.

Without `--data-dir` or `KUN_DATA_DIR`, the CLI reads `agents.kun.dataDir`
from the installed GUI settings. Existing users whose authoritative data is
still under `~/.deepseekgui/kun` therefore do not get split into a new
`~/.kun/data` runtime. Only provider endpoint and model-catalog metadata is
projected; API keys, OAuth tokens, and headers remain in the protected account
store. An explicit directory always wins and never imports metadata from an
unrelated GUI profile.

```bash
kun runtime status
kun runtime restart
kun runtime stop
```

`kun runtime status` remains read-only. `kun runtime stop` and `restart` do not
stop a GUI/TUI-owned Runtime or leave an ownerless detached replacement after a
one-shot command exits. They direct the user to the owning GUI, or to exit and
reopen the owning TUI. A lifecycle command executed by an agent tool against
its own Runtime remains rejected with `runtime_self_control_forbidden`.

`kun serve` is the explicit foreground/debug mode and is owned by the terminal
that starts it; normal signals stop its Runtime. It publishes discovery and
reports a conflict when a valid owner already occupies that data-directory /
flavor slot. Use `--url` for an explicit endpoint and `--no-start` to prevent
the TUI from changing service state. Non-TTY use prints a usage error without
starting a service; automation should use `kun run`, `kun chat`, or `kun exec`.

### Trying the development TUI

`npm run dev` starts the Electron GUI. To try the TUI by itself, without first
opening the GUI or a separate `kun serve`, run:

```bash
npm run dev:tui

# Forward options to the TUI
npm run dev:tui -- --workspace "$PWD" --continue
```

The command builds `kun/`, starts the terminal client, and starts a Runtime
owned by that TUI session. If another GUI/TUI owner occupies the same data-dir /
flavor slot, it reports an ownership conflict; really quit that owner (hiding
to tray is not a quit), or use an explicit non-owning connection. The welcome
surface focuses the composer: type a task and press Enter to create the first
conversation, use `/connect` to configure a model, `Ctrl+X L` to browse
sessions, and `Ctrl+P` to search every command. Exiting the TUI stops its exact
Runtime but leaves Service Manager and all saved data intact.

The welcome surface contains only the text identity `KUN`, one concise value
statement, Workspace/Model/Mode/Version metadata, and three starts: type a task,
`/connect`, or `/sessions`. It does not keep a large logo, runtime diagnostics,
MCP counts, or a full shortcut menu on screen. In a session, every assistant
turn is grouped under one `Kun` label, Thinking is collapsed by default, and
tools and Subagents use compact status/object/duration rows. The composer has
one input, provider/model · effort · mode metadata, and only actions valid in
the current context. Narrow layouts preserve titles, selection, errors, and
primary actions before secondary counts and descriptions.

Pressing Enter clears the composer immediately and shows an animated
`Sending message` status before the runtime acknowledges the turn.
Authoritative events then move that stable row through Waiting, Thinking,
Responding, tool, Subagent, Compacting, Retrying, or Reconnecting phases with
phase and total-turn timers. Approval and structured-input waits use a calmer
attention pulse. Ordinary notices share the right side of the row instead of
hiding active work.

This uses continuously perceptible progress without inventing a percentage:
each authoritative phase has distinct one-cell motion,
Responding uses a print-head rhythm, and tools and Subagents have their own
motion. The activity row appears only while sending, waiting, thinking,
responding, running a tool or child, retrying, or reconnecting, and disappears
when idle. When runtime context and usage are known, the right edge shows
`used / capacity · percent` as context occupancy, not generation progress.

Tool calls default to a single action/object/duration row whose completed
result terminates with `└`. `Ctrl+O` expands it into a `├ input` / `└ output`
tree. Running, completed, and failed tools use motion, a solid dot, and an
error mark respectively, with color reserved for status meaning. These
presentational changes retain inline mode and native terminal scrollback.

Consecutive read-only discovery calls in one phase are grouped into an
`Exploring` / `Explored` summary. Read, View, Search, Grep, Find, List, Fetch,
and Web Search may stay in one group across collapsed Thinking rows; an
answer, command, edit, delegation, approval, or structured input ends the
group. The compact view shows the first 12 actions and the remaining count.
`Ctrl+O` expands every action and its input/output. Failed actions remain in
the group and contribute to its title. Grouping changes only the TUI
presentation, not execution order, event history, or exports.

## Model connections

`/connect` opens the shared connection wizard:

- **Add a provider** is always the first landing action, even when connections
  already exist. Enter opens a searchable catalog with **Custom provider**
  first, followed by grouped subscription and API presets. GUI Settings and
  the TUI consume the same catalog: 19 base presets plus separate Xiaomi,
  MiniMax, Aliyun, and Tencent Cloud Token Plan entries, for 14 subscription
  entries and 9 API entries.
- The custom flow collects an editable ID, display name, Base URL, endpoint
  format, masked credential, and model IDs. Escape/Ctrl+C moves back one step,
  and no provider is created before final confirmation.
- Custom HTTP endpoints probe `/models` first. If discovery is unsupported but
  model IDs were supplied, Kun keeps the wizard open and offers an explicit
  `Ctrl+S` save-with-supplied-models action without claiming probe success.
- API keys, Token Plans, and custom compatible endpoints use masked input.
- ChatGPT uses device-code OAuth and shows a copyable URL and user code.
- Grok uses browser PKCE with a loopback callback. If the browser cannot return
  automatically, paste either the complete callback URL or the authorization
  code into the masked TUI field and press Enter. The draft is never echoed or
  written to shell history, ordinary settings, or logs.
- Claude Pro/Max uses the Agent SDK connection type; the TUI detects and, when
  necessary, downloads Claude Code before launching its official login flow.
- Multiple accounts receive stable, sequential account identifiers.
- Press Enter on a connected account to probe models, rename it, replace a
  credential with masked input, or confirm disconnect and default fallback.

Credentials are written only to the protected runtime credential store. The
registry and API expose `configured` state but never plaintext tokens. Every
mutation carries an expected revision; a stale writer receives HTTP `409` with
the latest snapshot. `/model` switches the shared default across every
connected provider/account/model. New threads use the new default while
threads with pinned routing remain unchanged.

The model picker is an exclusive primary-content route rather than a
transparent overlay over the welcome page or transcript. It shows only the
`KUN / Models` path, search, provider/account groups, model rows, and local
actions. Welcome/chat content, the composer, and global shortcut chrome are
hidden; selecting a model or pressing Escape restores the prior surface,
composer draft, and focus. It lists every configured GUI/shared-registry
provider and account.

Sessions, Commands, Reasoning, Mode, Connect, Subagents, Timeline, Skills,
Help, Status, Context, Queue, MCP, Permissions, Approval, and structured input
follow the same exclusive-route rule. Selectors use a breadcrumb, optional
search, flat groups, a cyan selection rail, and one contextual footer.
Connection pages show one current step, while read-only inspection pages group
fields and statuses instead of reusing a heavy generic modal.

If `/model` shows only DeepSeek, run `kun runtime status` and verify that its
data directory matches the GUI. An exact authenticated ownerless legacy shared
daemon may be retired narrowly on the first client-owned launch. Kun neither
attaches to nor terminates an older GUI-private or otherwise ambiguous process,
and it never starts a second writer for the same data-directory/flavor slot.
Really close or update the old owner first. Current GUI and TUI sessions then
start their own Runtimes sequentially while reusing the same persisted data.
`/connect` uses the protected credential/registry files in that data
directory, writes only a secret-free GUI compatibility projection, and
`/model` refreshes from the registry.

## Interaction

| Key | Action |
| --- | --- |
| `Enter` | Send a prompt/steer or confirm an option |
| `Ctrl+J` / `Shift+Enter` | Insert a composer newline (terminal dependent) |
| `Ctrl+X` | Leader; wait up to two seconds for the next key and show available actions |
| `Ctrl+P` | Open the searchable command palette |
| `Ctrl+X L` | Open the session search/switch page |
| `Ctrl+X N` | Create and open a session |
| `Ctrl+X P` | Enter or leave Pointer mode; only this mode lets Kun capture mouse clicks |
| `Ctrl+T` | Cycle the current model's supported reasoning efforts |
| `F2` / `Shift+F2` | Cycle recent models forward/backward |
| `Tab` / `Shift+Tab` | Cycle Agent/Plan when autocomplete is not active |
| `Ctrl+C` | Act like Escape in dialogs, confirmations, and model/connect routes; clear all text and attachments in a non-empty composer; press twice to exit while idle and completely empty |
| `Ctrl+D` | Forward-delete when non-empty; press twice to exit while idle and empty; request confirmation in Sessions |
| `Backspace` / `Delete` | Remove the most recently queued attachment when composer text is empty; retain normal text editing while text is present |
| `Esc` | Close autocomplete/the current page or interrupt the active turn; press twice while idle to safely undo the previous turn |
| `Ctrl+O` | Expand or collapse tool-call details in the transcript |
| `Ctrl+G` | Edit the current composer draft with `$VISUAL`/`$EDITOR` |
| `Ctrl+S` | Immediately steer a non-empty draft into the running turn |
| macOS `Cmd+V` / `Ctrl+X V`; Windows/Linux `Ctrl+V` | Read a screenshot from the system clipboard and queue it; `Alt+V` and forwarded `Ctrl+Shift+V` / `Super+V` are also accepted |
| `Ctrl+L` | Redraw |
| `Shift+PgUp/PgDn` | Native terminal scrollback; not captured by Kun |

Kun leaves terminal mouse reporting disabled by default. Drag to select any
transcript text, then use the terminal's own copy shortcut.
Codex/VS Code integrated terminals commonly let `Ctrl+C` copy an existing
selection; macOS Terminal/iTerm2 normally use `Cmd+C`, while Linux and Windows
terminals commonly use `Ctrl+Shift+C`. Without a selection, `Ctrl+C` keeps its
Kun back, clear, interrupt, or exit behavior.

The terminal host handles platform paste shortcuts such as `Cmd+V` before a
TUI process can see them, and an image-only clipboard usually produces no text
bytes for the terminal to forward. Kun advertises `Cmd+V` on macOS and handles
forwarded `Super+V` or an empty bracketed-paste gesture as a clipboard-image
action. If the host consumes the shortcut completely, press `Ctrl+X` and then
`V`, which Kun handles as a reliable Leader sequence. Forwarded `Ctrl+V`,
`Alt+V`, and `Ctrl+Shift+V` run the same image-read/upload path. `/paste`
remains the keyboard-independent fallback.

Queued images and files appear as ordered `Attachment 1/n` rows inside the
composer instead of floating outside the input. On macOS, Windows, and Linux,
press Backspace or the physical Delete key while the text editor is empty to
remove attachments in reverse order. While text is present, those keys edit
only the text and cannot accidentally remove an attachment.
`/attach remove <n>` removes a specific item, and `/attach clear` clears the
attachment draft.

After a file or image is sent, the persisted `You` message shows an
`Image/File` row with its name, media type, size, and image dimensions when
available. If an older runtime cannot return metadata, Kun still renders an
`Attachment · attached` marker so the message never looks text-only.

Press `Ctrl+X P` or run `/mouse on` when you want to click a Thinking or
Subagent row. The footer clearly identifies Pointer mode. Esc/Ctrl+C or
`/mouse off` immediately restores native selection, so selecting ordinary
conversation text never requires holding Shift.

### Sessions and content

| Command | Action |
| --- | --- |
| `/sessions [search]` | Search, pin, switch, or confirm deletion of persisted sessions |
| `/new [title]`, `/open <id>`, `/rename <title>`, `/archive` | Create, open, rename, or archive a thread |
| `/fork [title]` | Branch from the complete current history |
| `/undo`, `/redo` | Navigate safe branches; the source session is never rewritten |
| `/timeline [search]`, `/jump [number\|text]` | Browse/locate turns and optionally fork at the selected turn |
| `/subagents` | Browse delegated children and open a selected child as a read-only live transcript; Pointer mode can open a visible Subagent block in the same popup |
| `/copy`, `/export [path]` | Copy the latest Kun response or safely export the complete thread as Markdown; existing files are not overwritten |
| `/details`, `/thinking` | Toggle expanded tool details or reasoning text; `/reasoning` remains an alias |
| `/paste` | Read a screenshot from the system clipboard and queue it; equivalent to forwarded `Cmd+V` on macOS, with `Ctrl+X V` always available |
| `/attach <path>`, `/attach list`, `/attach remove <n>`, `/attach clear` | Add a file, inspect queued attachments, remove one item, or clear them all |
| `/mouse [on\|off]` | Toggle clickable Pointer mode; when off, the terminal owns selection and copy |
| `/variants` | Select reasoning effort using the same state as `Ctrl+T` and the turn request |
| `/compact` | Ask the current Runtime to compact long context |

### Runtime and project

| Command | Action |
| --- | --- |
| `/status`, `/context`, `/queue` | Inspect connection/thread state, token usage, and steering queued on the active turn |
| `/permission` | Select thread approval and sandbox policies and synchronize them to other clients |
| `/plan [plan\|agent]`, `/goal [objective\|pause\|resume\|clear]` | Inspect/switch planning mode and manage the persisted goal |
| `/tasks` | Aggregate plan todos, the persistent goal, child agents, background shells, and extension jobs |
| `/mcp` | Show shared MCP servers, connection status, tool counts, and tool names |
| `/skills [search]`, `/skill:<name> [prompt]` | Browse workspace-visible skills or explicitly activate one |
| `/init [guidance]` | Ask Kun to inspect the repository and create or update root `AGENTS.md` |
| `/add-dir <path>` | Persist another workspace root on the thread; tools and sandbox policy recognize it |
| `/editor [draft]` | Edit the composer in `$VISUAL`/`$EDITOR`, with TUI pause, terminal/focus restoration, and the edited draft preserved |
| `/btw <question>` | Ask in a snapshot-inheriting side thread without mutating the main thread |
| `/connect`, `/model` | Manage shared model connections or select the shared default model |
| `/update`, `/update yes` | Check a Stable standalone TUI update or explicitly confirm installation; the GUI-bundled build directs updates to the GUI |
| `/help`, `/quit` | Open help or exit the TUI |

Compatibility aliases: `/threads`, `/resume`, and `/continue` → `/sessions`, `/clear` →
`/new`, `/title` → `/rename`, `/models` → `/model`, `/provider` → `/connect`,
`/summarize` → `/compact`, and `/q` → `/quit`. The aliases are also present in
pi-tui autocomplete.

Assistant text uses pi-tui Markdown. Tool calls and results are compact by
default. Thinking starts as a one-line collapsed duration summary without its
reasoning body. `/thinking` expands every body as muted italic text and toggles
back to collapsed. In Pointer mode, primary-click one Thinking title to toggle
only that segment; its body and neighboring messages are not click targets.
Streaming fragments continue to accumulate while
collapsed, so expanding restores the complete text. `Ctrl+T` prefers complete GUI/registry
`modelProfiles`; when an older GUI omits them, Kun restores audited
provider/model capabilities for DeepSeek, GLM, MiMo, MiniMax M3, Kimi K3,
Grok 4.5, Claude Opus/Sonnet, Qwen, Hunyuan, Doubao, and compatible ZenMux
models. Chat Completions, Responses, Anthropic Messages, and the Claude Agent
SDK receive real reasoning parameters, so the UI never exposes a no-op effort
switch. Unknown custom models remain conservative. Obsolete GLM, Qwen,
Hunyuan, Doubao, and Kimi K3 metadata is migrated to the current protocol.
CSI, OSC, DCS, APC, and related control sequences are removed from
all model/tool/server text before rendering.

Delegated work stays compact in the parent timeline. `/subagents` opens an
exclusive child list; Enter uses the runtime's authoritative child thread id,
loads its persisted snapshot, and follows its sequenced SSE stream. The child
view renders the same streamed replies, collapsed Thinking, tools, failures,
and nested children as the parent, but intentionally has no composer while the
internal agent owns the run.

In terminals that support SGR mouse reporting, enter Pointer mode and
primary-click a visible Subagent block to open that child directly in a
centered popup. Use the wheel, arrow keys, or PageUp/PageDown to read it; click
a Thinking title to toggle one segment, press `t` to toggle all Thinking, and
use Esc/Ctrl+C to close it and restore native text selection. Mouse support is
optional—`/subagents` plus Enter remains the portable path.

### Custom keybindings

The TUI reads `~/.kun/tui.json` using an OpenCode-compatible shape. It accepts
single keys, comma-separated alternatives, arrays, `<leader>`, `"none"`/`false`,
and advanced objects with `event`, `preventDefault`, and `fallthrough`:

```json
{
  "leader_timeout": 2000,
  "keybinds": {
    "leader": "ctrl+x",
    "variant_cycle": "ctrl+t",
    "session_list": "<leader>l",
    "input_newline": ["shift+return", "ctrl+j"]
  }
}
```

Invalid configuration does not block startup; Kun falls back to defaults and
reports a sanitized warning in the welcome surface and stderr. Recent/favorite
models and per-model effort are stored without credentials in
`<data-dir>/tui/state.json` (mode `0600` on POSIX).

## External connections, reconnects, and security

Clients hydrate an authoritative thread snapshot and `latestSeq`, then
subscribe to SSE at that cursor. Reconnects revalidate discovery and replay
missing events; duplicate and out-of-order events are ignored. Default GUI/TUI
owners do not coexist in one data-directory/flavor slot; only explicit
non-owning modes such as `--url` and `--no-start` may coexist with an owner.
When another explicit client resolves an approval or input first, stale
controls are retired. Once the owner exits, its Runtime stops and external
clients must wait for a new explicit target.

`item.text` in `assistant_text_delta` and `assistant_reasoning_delta` is a
fragment. The TUI appends it by stable item ID and lets
`item_created/updated/completed` replace state with authoritative snapshots, so
text appears before turn completion without duplication after reconnect.

- The data directory is mode `0700`; discovery/token files are `0600` on POSIX.
- Discovery accepts loopback HTTP only and verifies instance ID, PID, start
  time, and service version.
- Runtime shutdown requires loopback, bearer authentication, and the current
  instance ID, so an old client cannot stop a replacement instance.
- A GUI/TUI-owned Runtime uses an OS IPC ownership channel to detect abnormal
  parent exit and enter bounded graceful shutdown. Normal exit still performs
  explicit exact-instance shutdown and wait.
- API keys, OAuth tokens, and subscription credentials are kept out of argv,
  shell history, logs, and ordinary settings.

## Installing the terminal command

- Windows NSIS installs `bin\\kun.cmd` and adds that exact directory to PATH.
- macOS offers a first-launch install into `/usr/local/bin/kun`; Settings can
  install, repair, or remove a stale symlink after the app moves.
- Linux AppImage installs a wrapper in `~/.local/bin/kun` and can add a marked,
  safely removable PATH block for bash, zsh, or fish.

Open a new terminal after PATH changes and verify with `kun --help`.
