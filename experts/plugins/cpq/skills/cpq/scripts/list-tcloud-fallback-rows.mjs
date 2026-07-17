#!/usr/bin/env node

/**
 * P2c 兜底辅助：扫 inquiry-price-parallel 的 summary.xlsx，
 * 列出所有需要走 ② tcloud 兜底的行（status ∈ failed/timeout/aborted_by_user，
 * 或 concluded 但 price_info 为空）。
 *
 * 主流程读这份输出后，逐行调 tencent-cloud-pricing 的 tcloud-price quote 兜底，
 * 再把成功结果合并回 phase4_1-input.json 的对应行（询价链路标 `①miss(<原因>)→②hit`）。
 *
 * 用法：
 *   node scripts/list-tcloud-fallback-rows.mjs --run-dir <inquiry-run-dir> [--json]
 *
 * 输出（默认人类可读 + 提示）：
 *   T 行需要兜底；下面是建议命令清单
 *
 * 输出（--json）：
 *   {
 *     "run_dir": "...",
 *     "fallback_rows": [
 *       {"task_id": "task_003", "source_row_index": 3,
 *        "status": "failed", "miss_reason": "异常重试耗尽",
 *        "last_message_excerpt": "<前 200 字>"}
 *     ],
 *     "summary": {"total": 4, "needs_fallback": 1}
 *   }
 *
 * 实现细节：
 *   - xlsx 解析委托 managed Python venv 的 openpyxl（避免 Node 引入新依赖）
 *   - Python 兜底脚本走环境变量 CPQ_PYTHON 覆盖（默认 /Users/ryoliu/.workbuddy/...）
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_PYTHON =
  process.env.CPQ_PYTHON || '~/.workbuddy/binaries/python/envs/default/bin/python';

const PY_INLINE = `
import json, sys
from pathlib import Path
try:
    from openpyxl import load_workbook
except ImportError:
    print(json.dumps({"error": "openpyxl 未安装", "fix": "pip install openpyxl"}), flush=True)
    sys.exit(2)

run_dir = Path(sys.argv[1])
xlsx_path = run_dir / "summary.xlsx"
if not xlsx_path.exists():
    print(json.dumps({"error": f"summary.xlsx 不存在: {xlsx_path}"}), flush=True)
    sys.exit(2)

wb = load_workbook(filename=str(xlsx_path), read_only=True, data_only=True)
ws = wb.active
rows_iter = ws.iter_rows(values_only=True)
try:
    headers = [str(h) if h is not None else "" for h in next(rows_iter)]
except StopIteration:
    print(json.dumps({"error": "summary.xlsx 为空"}), flush=True)
    sys.exit(2)

def col(name, *aliases):
    for n in (name, *aliases):
        if n in headers:
            return headers.index(n)
    return -1

idx_task   = col("task_id")
idx_row    = col("source_row_index", "row_index", "row_id")
idx_status = col("status")
idx_concl  = col("conclusion")
idx_price  = col("remote_price", "price_info")
idx_info   = col("result_info")

fallback_rows = []
total = 0
for row in rows_iter:
    if row is None:
        continue
    total += 1
    def get(i):
        return "" if i < 0 or i >= len(row) or row[i] is None else str(row[i])
    status = get(idx_status)
    price = get(idx_price)
    needs_fb = False
    miss_reason = ""
    if status in ("failed", "timeout", "aborted_by_user"):
        needs_fb = True
        miss_reason = status
    elif status == "concluded" and not price.strip():
        needs_fb = True
        miss_reason = "concluded_no_price"
    if needs_fb:
        excerpt = get(idx_info).replace("\\n", " ").strip()
        if len(excerpt) > 200:
            excerpt = excerpt[:200] + "..."
        fallback_rows.append({
            "task_id": get(idx_task),
            "source_row_index": get(idx_row),
            "status": status,
            "conclusion": get(idx_concl),
            "miss_reason": miss_reason,
            "last_message_excerpt": excerpt,
        })

print(json.dumps({
    "run_dir": str(run_dir),
    "fallback_rows": fallback_rows,
    "summary": {"total": total, "needs_fallback": len(fallback_rows)},
}, ensure_ascii=False), flush=True)
`;

function listFallbackRows(runDir) {
  if (!isAbsolute(runDir)) {
    return { error: `--run-dir 必须是绝对路径，收到：${runDir}` };
  }
  if (!existsSync(runDir)) {
    return { error: `run-dir 不存在：${runDir}` };
  }
  if (!existsSync(join(runDir, 'summary.xlsx'))) {
    return { error: `summary.xlsx 不存在：${join(runDir, 'summary.xlsx')}` };
  }
  let out;
  try {
    out = execFileSync(DEFAULT_PYTHON, ['-c', PY_INLINE, runDir], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return {
      error: `Python 子进程失败：${e.message}`,
      stderr: (e.stderr || '').toString().slice(0, 500),
    };
  }
  try {
    return JSON.parse(out.trim().split('\n').pop());
  } catch (e) {
    return { error: `解析 Python 输出失败：${e.message}`, raw: out.slice(0, 500) };
  }
}

function cliMain() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--run-dir');
  const json = args.includes('--json');
  if (idx < 0 || !args[idx + 1]) {
    process.stderr.write(
      '用法: node scripts/list-tcloud-fallback-rows.mjs --run-dir <inquiry-run-dir> [--json]\n',
    );
    process.exit(1);
  }
  const runDir = args[idx + 1];
  const result = listFallbackRows(runDir);
  if (result.error) {
    if (json) console.log(JSON.stringify(result));
    else process.stderr.write(`❌ ${result.error}\n`);
    process.exit(2);
  }
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  const { fallback_rows, summary } = result;
  if (summary.needs_fallback === 0) {
    console.log(`[list-tcloud-fallback] 无需兜底 · 总行数=${summary.total}`);
    process.exit(0);
  }
  console.log(
    `[list-tcloud-fallback] ${summary.needs_fallback} / ${summary.total} 行需要 ② tcloud 兜底：\n`,
  );
  for (const r of fallback_rows) {
    console.log(
      `  · task=${r.task_id} src_row=${r.source_row_index} ` +
        `status=${r.status} 原因=${r.miss_reason}`,
    );
    if (r.last_message_excerpt) {
      console.log(`    备注：${r.last_message_excerpt}`);
    }
  }
  console.log('');
  console.log(
    '请按 references/how-to-query-pricing.md §"预估路 ②" 用 tcloud-price quote 逐行兜底，' +
      '成功后把价格 / 四层填进 phase4_1-input.json 对应行，并把「询价链路」标为 `①miss(<原因>)→②hit`。',
  );
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cliMain();
}

export { listFallbackRows };
