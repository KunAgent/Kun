/**
 * 书稿工作区内 `.workbuddy/memory/` 叙事层追加（策略 B：与 `.fbs` 真值并行）
 */
import fs from 'fs';
import path from 'path';

function todayTag() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 在 `bookRoot/.workbuddy/memory/YYYY-MM-DD.md` 追加一段 FBS 退出镜像（幂等块可重复调用）
 * @param {{ bookRoot: string, title?: string, lines: string[], quiet?: boolean }} opts
 * @returns {{ path: string | null, appended: boolean }}
 */
export function appendWorkbuddyMemoryMirror({ bookRoot, title = 'FBS session 镜像', lines, quiet = false }) {
  const root = path.resolve(bookRoot);
  const memDir = path.join(root, '.workbuddy', 'memory');
  const file = path.join(memDir, `${todayTag()}.md`);
  try {
    fs.mkdirSync(memDir, { recursive: true });
    const block = [
      '',
      `### ${title} — ${new Date().toISOString()}`,
      '',
      ...lines.map((l) => (l.startsWith('-') || l.startsWith('|') ? l : `- ${l}`)),
      '',
    ].join('\n');
    fs.appendFileSync(file, block, 'utf8');
    if (!quiet) console.log(`[workbuddy-memory] 已追加叙事层：${file}`);
    return { path: file, appended: true };
  } catch (e) {
    if (!quiet) console.warn('[workbuddy-memory] 追加失败（不阻断退出）：', e.message);
    return { path: null, appended: false };
  }
}
