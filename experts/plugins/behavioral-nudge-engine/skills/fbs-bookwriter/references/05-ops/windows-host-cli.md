# Windows / PowerShell 宿主与 Node 脚本输出

> 背景：WorkBuddy 等宿主在 **PowerShell 5.x** 下执行 `node … --json` 时，可能出现 stdout 被 **CLIXML** 包装或混流，导致 `intake-router` 等 JSON 被截断或不可解析（非脚本逻辑错误）。

## 推荐：JSON 落盘（首选）

```bash
node scripts/intake-router.mjs --book-root "<书稿根>" --intent auto --json --json-out .fbs/intake-router.last.json
```

随后在宿主侧 **read_file** 读取 `.fbs/intake-router.last.json`。终端仅一行 `JSON written to: …`，便于确认成功。

## 备选：控制台 UTF-8（减轻乱码，不保证解决 CLIXML）

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
node scripts/intake-router.mjs --book-root "<书稿根>" --intent auto --json
```

## 质检脚本

`quality-auditor-lite.mjs`、`quality-auditor.mjs` 等**无需** Unix 管道（`| head`）；请使用：

- `--book-root <根>` + `--glob` / `--inputs`
- 或 `--json` 将结果写入文件（若脚本支持 `--json-out`）

## 禁止

- 在 PowerShell 中使用 **`powershell -Command` 内联 `$` 变量**（见 `env-preflight` 与 `env-preflight` 报告中的 `powershell_command_policy`）。
- 在 Windows PowerShell 中勿使用 **Unix 风格管道**（如 `node … 2>&1 | head -5`、`| grep`）；管道与 `head`/`grep` 行为与 bash 不一致，易导致失败或截断。请直接获取完整输出、使用 `--json-out` 落盘，或在宿主内用 read_file 再处理。
