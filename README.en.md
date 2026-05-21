<p align="center">
  <img src="src/asset/img/deepseek.png" width="96" alt="DeepSeek GUI icon">
</p>

# DeepSeek GUI

[简体中文](./README.md) | English

> Bring the local DeepSeek TUI agent into a desktop workbench: chat, workspaces, change review, Skill/MCP management, and updates in one graphical app.

[Website](https://deepseek-gui.com)

[![GitHub release](https://img.shields.io/github/v/release/XingYu-Zhong/DeepSeek-GUI?label=github)](https://github.com/XingYu-Zhong/DeepSeek-GUI/releases)
[![License](https://img.shields.io/github/license/XingYu-Zhong/DeepSeek-GUI)](./LICENSE)

DeepSeek GUI is a local desktop workbench for developers and frequent AI users. It builds on [DeepSeek TUI](https://github.com/Hmbown/DeepSeek-TUI) and turns the terminal agent experience into an easier, longer-lived app: choose a workspace, start a task, watch reasoning and tool calls stream in, review file changes, and approve sensitive actions when needed.

The goal is not to ship another chat wrapper. The goal is to make DeepSeek feel like a reliable desktop partner for real project work.

---

## What We Built

- A desktop app around the DeepSeek TUI local runtime, with default runtime auto-start and management.
- A full chat workbench with multiple sessions, streaming output, history, interruption, and resend flows.
- Local workspace integration so the agent can read, edit, and create files in real projects.
- Change review surfaces that make every file modification visible and inspectable.
- First-run onboarding, settings, language/theme/font controls, notifications, local logs, and update entry points.
- Graphical Skill and MCP management so users can extend the agent without hand-editing every config file.
- Claw background automation with Feishu / Lark integration, dedicated IM agents, local webhook / relay support, and scheduled tasks.
- Pre-built macOS and Windows installers; Linux/Unix users can build from source.

## Highlights

- **Desktop chat workbench**: multi-session chat with streamed replies, reasoning, tool calls, approval requests, and file changes in one place.
- **Project workspaces**: choose a local directory for each task, organize sessions by workspace, preview files, open files in your editor, and pick Git branches.
- **Change review**: inline diffs and a side review panel help you understand exactly what the agent changed.
- **Controlled permissions**: choose read-only, workspace-write, full-access, or external sandbox modes, and decide when tool calls require approval.
- **Managed runtime**: use the bundled DeepSeek TUI by default, or point the app at your own `deepseek` executable.
- **Skill and MCP support**: create Skills, edit MCP config, add common tools, and open the related folders from the UI.
- **Claw background automation**: run a background agent alongside normal chat, with current support for Feishu / Lark, IM webhook / relay flows, and scheduled tasks.
- **Friendly first launch**: choose language, add your DeepSeek API key, and optionally set a compatible Base URL.
- **Local-first**: preferences, sessions, logs, and runtime config stay on your machine; model calls use your own DeepSeek API key.
- **English and Chinese UI**: switch languages from Settings at any time.
- **Cross-platform use**: macOS `.dmg/.zip` and Windows `.exe`; Linux/Unix users can build from source.

## Who It Is For

- Developers who want DeepSeek to work on real codebases without living in a terminal.
- Teams that need to see what the agent did, which files changed, and which operations required approval.
- Users who maintain multiple projects or long-running conversations and want reusable Skill/MCP setup.
- Anyone who wants a local desktop workbench connected to the official DeepSeek API or a compatible endpoint.

---

## Install

### Download a Pre-built Package

Download the latest build from [GitHub Releases](https://github.com/XingYu-Zhong/DeepSeek-GUI/releases):

| Platform | Package |
| --- | --- |
| macOS | `.dmg` or `.zip`, Intel and Apple Silicon |
| Windows | `.exe`, NSIS installer, x64 |

Linux/Unix pre-built downloads are currently not published. Linux users can build from source; because the built-in terminal depends on the native `node-pty` module, build Linux packages on Linux instead of cross-packaging them from macOS or Windows.

On first launch, enter your [DeepSeek API key](https://platform.deepseek.com/api_keys). If you use a DeepSeek/OpenAI-compatible endpoint, you can set a custom Base URL in Settings.

### Run from Source

For contributors and local development:

```bash
git clone https://github.com/XingYu-Zhong/DeepSeek-GUI.git
cd DeepSeek-GUI
npm install
npm run dev
```

Requirements:

- Node.js 20+
- A DeepSeek API key
- Internet access during the first dependency install

For slower network access in mainland China, use an npm mirror:

```bash
npm install --registry=https://registry.npmmirror.com
```

---

## First Run

1. Open DeepSeek GUI.
2. Choose your interface language in the onboarding guide.
3. Enter your DeepSeek API key; set a custom Base URL if needed.
4. Choose a default workspace, or use the default directory created by the app.
5. Start a new session and describe the task you want the agent to handle.

Typical flow:

- Pick or switch a workspace from the sidebar.
- Describe the task in the composer.
- Watch reasoning, tool calls, command execution, and file changes as they happen.
- Allow or deny actions that require approval.
- Inspect changes in the review panel before deciding what to do next.

If you want to use Claw automation:

- Open `Claw` in Settings and enable background automation.
- Add a Feishu / Lark connection, then configure the agent name, profile, default model, and workspace for that channel.
- Enable the local webhook / relay path if needed, and create scheduled tasks so Claw can keep handling inbound messages or periodic jobs in the background.

## Usage and Settings

Settings manages:

- DeepSeek API key, Base URL, runtime port, and runtime token.
- Auto-start for the local runtime, plus optional custom `deepseek` path.
- Tool approval policy and filesystem access mode.
- Default workspace, language, theme, font size, and completion notifications.
- GUI updates, DeepSeek TUI updates, and local error logs.
- Skill creation, Skill folders, and MCP config editing.
- Claw background automation, Feishu / Lark connections, webhook / relay settings, and scheduled tasks.

Keyboard shortcuts:

| Key | Action |
| --- | --- |
| `Enter` | Send message |
| `Shift+Enter` | Newline in composer |
| `Ctrl+Enter` | Send message |
| `Esc` | Close a panel or dismiss the current overlay |

---

## Uninstall

### Windows

- Open Settings -> Apps -> Installed apps, find `DeepSeek GUI`, and uninstall it.
- Or uninstall from Control Panel -> Programs and Features.
- Or run the uninstaller from the installation directory.

The Windows installer creates Start Menu and desktop shortcuts by default. It does not force a taskbar pin; pin it manually from the Start Menu if you want one.

### macOS

- Move `DeepSeek GUI.app` from Applications to Trash.
- If macOS blocks the app on first open, right-click it in Finder and choose Open.
- For local unsigned builds, you can remove the quarantine attribute first:

```bash
npm run mac:unquarantine -- '/Applications/DeepSeek GUI.app'
```

### Linux

- If you built a Linux package from source, delete the related `.AppImage` or installed files.
- If you manually created a desktop entry or shortcut, delete that too.

### Remove Local Data

By default, uninstalling removes the app but keeps local settings, sessions, and runtime config so reinstalling is smoother. For a full cleanup, remove these paths if needed:

| Platform | App data path |
| --- | --- |
| macOS | `~/Library/Application Support/DeepSeek GUI` |
| Windows | `%APPDATA%\DeepSeek GUI` |
| Linux | `~/.config/DeepSeek GUI` |

DeepSeek TUI shared config usually lives in `~/.deepseek`. Check it before deleting, because it may contain API key, MCP, or Skill settings you still need.

---

## Updates

- For regular users: macOS/Windows can check GUI updates in Settings or download the latest installer from [GitHub Releases](https://github.com/XingYu-Zhong/DeepSeek-GUI/releases); Linux/Unix users should build from source.
- For the DeepSeek TUI runtime: when the GUI manages the runtime, Settings can check and upgrade the bundled TUI.

## Contributing

Contributions are welcome for bug fixes, UI/UX improvements, documentation, localization, build/release workflows, and runtime integration.

Project conventions:

- The current default collaboration branch is `develop`.
- Start features and fixes from the latest `develop`, preferably on a short-lived feature branch.
- Open pull requests into `develop` by default; maintainers merge reviewed changes into `master`.
- Align on scope first for larger or riskier changes.
- Run `npm run typecheck`, `npm run build`, and `npm run test` before opening a PR.
- Include a video or GIF when the UI changes.
- Include unit tests when project logic changes.
- Update both `README.md` and `README.en.md` when usage changes.

See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) and [DEVELOPMENT.md](./docs/DEVELOPMENT.md) for details.

## Local Build

```bash
npm run build           # production build
npm run dist:mac        # macOS packages
npm run dist:win        # Windows installer
npm run dist:linux      # Linux AppImage; run this on Linux
```

Linux/Unix pre-built downloads are not published for now. If you need a Linux build, install dependencies and run `npm run dist:linux` in the target Linux environment; the built-in terminal depends on `node-pty`, and cross-packaging can make terminal startup fail.

For the full development workflow, see [DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## Documentation

| Doc | Contents |
| --- | --- |
| [CONTRIBUTING.md](docs/CONTRIBUTING.md) | Contribution guide |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local development workflow |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community code of conduct |
| [SECURITY.md](SECURITY.md) | Security disclosure policy |

For the underlying runtime, see [DeepSeek TUI](https://github.com/Hmbown/DeepSeek-TUI).

---

## Thanks

- [DeepSeek TUI](https://github.com/Hmbown/DeepSeek-TUI): the local agent runtime behind the app.
- [LobsterAI](https://github.com/netease-youdao/LobsterAI): its IM management, QR binding, agent binding, and customizable agent-profile flows inspired the Claw IM integration in this project.
- [DeepSeek](https://github.com/deepseek-ai): for the models and API.
- Everyone who contributes issues, ideas, code, and documentation to DeepSeek GUI.

> [!NOTE]
> This project is not affiliated with DeepSeek Inc.

## License

[MIT](./LICENSE)

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=XingYu-Zhong/DeepSeek-GUI&type=date&legend=top-left)](https://www.star-history.com/?repos=XingYu-Zhong%2FDeepSeek-GUI&type=date&logscale=&legend=top-left)
