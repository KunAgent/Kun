# Contributing

[简体中文](./CONTRIBUTING.zh-CN.md)

Thank you for contributing to Kun.

This document explains how contributors should collaborate on the project, what standards to follow, and how changes should be proposed.

## Project Taste

Code is easy. Good taste is rare.

For Kun, taste means clear workflows, restrained interfaces, humane copy, and behavior that feels obvious after one use. Strong contributions show judgment, not just implementation.

## Contribution Scope

Contributions are welcome for:

- bug fixes
- UI and UX improvements
- runtime integration improvements
- documentation
- localization
- build and release workflow improvements

## Branch Strategy

The expected branch flow is:

- `develop`: active collaboration and daily integration branch
- `master`: stable release branch, updated by maintainers from `develop`
- feature branches: optional short-lived branches created from `develop`

Rules:

- Do not develop directly on `master`
- Prefer starting work from the latest `develop`
- If you create a feature branch, branch off from `develop`
- Open pull requests into `develop` unless maintainers explicitly request another base branch

## Before You Start

1. Make sure your local repository is up to date.
2. Switch to `develop`.
3. Install dependencies with `npm install`.
4. Confirm the project starts or builds successfully before making changes.

## Shape of a Typical PR

A well-structured PR for Kun is focused and self-contained. It typically:

- Touches **1-3 new files** and modifies **2-5 existing files** for wiring
- Scopes to a single feature, fix, or documentation update
- Includes a video or GIF if the UI changed
- Includes unit tests if project logic changed
- Passes `npm run typecheck`, `npm run build`, and `npm run test`

If you discover related work that needs doing, open a separate issue rather than expanding the PR scope.

## Local Development Checklist

Before opening a PR, contributors should verify:

- the app still runs in development with `npm run dev`
- type checking passes with `npm run typecheck`
- production build passes with `npm run build`
- unit tests pass with `npm run test`
- UI changes include a video or GIF that shows the changed flow
- logic changes include unit tests for the changed behavior
- documentation is updated if behavior, setup, or workflow changed
- localization is updated if user-facing text changed

### CI Verification Commands

```bash
# Type checking
npm run typecheck

# Production build
npm run build

# Unit tests
npm run test

# Full development smoke test
npm run dev
```

## Coding Expectations

- Keep changes focused and scoped
- Avoid unrelated refactors in the same PR
- Follow existing project structure and naming conventions
- Prefer readable code over clever code
- Preserve cross-platform behavior where possible
- Do not commit secrets, API keys, tokens, or machine-specific private paths

## Documentation Expectations

When your change affects project usage or collaboration, update the relevant docs:

- `README.md` and `README.en.md` for project-level usage
- `docs/DEVELOPMENT.md` and `docs/DEVELOPMENT.zh-CN.md` for workflow/process updates
- this contributing guide when standards change

## Pull Request Standards

Each PR should:

- have a clear and specific title
- explain what changed and why
- describe user-facing impact
- mention any setup, migration, or compatibility notes
- stay reasonably small when possible

Recommended PR structure:

```text
## Summary

What this PR does in 1-2 sentences.

## Why

The problem or gap it addresses.

## Validation

How you verified the change (commands run, manual tests performed).

## Media

Attach a video or GIF if UI changed. Screenshots are welcome as extra context.

## Tests

List unit tests added or updated if project logic changed.
```

For most contributions, opening the PR from a short-lived feature branch is preferred over pushing directly to `develop` or `master`.

## Review Standards

Reviewers should evaluate:

- correctness
- regressions
- product taste and interaction quality
- clarity and maintainability
- consistency with current architecture
- documentation completeness
- whether validation steps were actually performed

## Commit Guidance

Good commits are:

- small enough to review
- logically grouped
- written with clear commit messages

Follow conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `style:` Formatting, UI polish
- `chore:` Maintenance tasks

Examples:

- `docs: rewrite README and contribution guides`
- `feat: improve runtime connection recovery`
- `fix: handle missing Kun binary path`

## Reporting Issues

When reporting issues, please include:

- Operating system and version
- Kun version (from Settings or the About dialog)
- Bundled `kun` version (`kun --version` in the same directory, if available)
- Steps to reproduce the issue
- Expected vs actual behavior
- Relevant error messages, logs, or screenshots

## Contributor Behavior

Please collaborate in a way that is:

- respectful
- clear
- constructive
- open to feedback

If a change is large or risky, align with maintainers before investing heavily in implementation.

## Need Help?

If requirements are unclear, ask for clarification before making broad architectural or workflow changes. Feel free to open an issue for any questions about contributing.

## License

External contributions are accepted under the [Contributor License Agreement](../CLA.md).
By submitting a contribution, you agree to grant the project owner the rights
described in the CLA, including the right to sublicense and relicense your
contribution as part of Kun under commercial, proprietary, noncommercial, or
other license terms.

The project itself remains available under the [PolyForm Noncommercial License 1.0.0](../LICENSE)
unless the project owner grants a separate written commercial license.

## 飞书 / Lark 流式 smoke 测试（发版前必跑）

本节对应 `feature/feishu-streaming-with-live-fix` 引入的飞书 / Lark SDK markdown 流式回复功能。发版前必须手工跑一遍下列 case。

### 自动化已覆盖

| 维度 | 覆盖方式 |
|---|---|
| 单条流式正常路径 | `src/main/feishu-streamer.test.ts` happy-path case |
| reasoning delta 过滤 | 同上,reasoning case |
| 跨 turn 过滤 | 同上,cross-turn case |
| append 失败 → setContent(partial) | 同上,append-failure case |
| SSE 订阅失败 → 一次性 send fallback | `src/main/claw-runtime.test.ts` streaming fallback case |
| `feishuStream = false` → 走原轮询 | 同上,feishuStream=false case |
| 集成 chat 视图实时性 | `src/renderer/src/components/chat/MessageTimeline.tool-summary.test.ts` live bubble case |
| onClawChannelActivity 自动切 thread | `src/renderer/src/store/chat-store-navigation-actions.test.ts` 路由 case |

### 手工 smoke checklist

- [ ] **单条对话**:发"你好" → streaming 卡出现 → 1-2 秒内开始刷字
- [ ] **长回答**:写一段代码 → 验证 30k 字符切卡能跨第二张卡
- [ ] **故意限流**:把 `outbound.retry.maxAttempts = 1` → 触发限流 → 观察 fallback 到一次性 send
- [ ] **故意 turn_failed**:用会抛错的 MCP 工具 → 观察 partial 补发
- [ ] **群聊 @bot**:`replyInThread: true` 仍生效,streaming 卡出现在 thread 里
- [ ] **DM**:`replyInThread: false` 默认
- [ ] **Connect phone 视图实时性**(关键 —— 本期修复):bot 收到消息后 chat 视图立即出现 streaming 文本,不卡
- [ ] **主动点击 thread**:从 streaming 状态切到该 thread → blocks 与 liveAssistant 内容一致
- [ ] **跨 turn 隔离**:在 turn A streaming 中再来一条消息触发 turn B → turn A 收尾,turn B 独立开卡

### 验证命令

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:kun
# Electron 手动启动 + 真飞书账号(本机 + 测试机器人 appId/secret)
npm run dev
```
