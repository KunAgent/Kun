/**
 * 安全写入 .fbs 下 JSON：临时文件 + rename，可选 .bak 备份。
 * 防止异常中断产生半写入；便于从误写恢复。
 */
import fs from 'fs';
import path from 'path';

/**
 * @param {string} fbsDir 已解析的 .fbs 目录绝对路径
 * @param {string} fileName 仅文件名，如 workbuddy-resume.json
 */
export function resolveFbsJsonPath(fbsDir, fileName) {
  const base = path.resolve(fbsDir);
  const out = path.join(base, fileName);
  const rel = path.relative(base, out);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`safe-fbs-json-write: 拒绝路径越界 ${fileName}`);
  }
  if (path.basename(out) !== fileName) {
    throw new Error(`safe-fbs-json-write: 非法文件名 ${fileName}`);
  }
  return out;
}

function tryReadText(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 原子写文本（内容相同可跳过），返回写入状态。
 *
 * @param {string} fbsDir
 * @param {string} fileName
 * @param {string} text
 * @param {{ backup?: boolean, quiet?: boolean, skipIfUnchanged?: boolean }} [opts]
 * @returns {{ path: string, changed: boolean, skipped: boolean }}
 */
export function writeTextAtomic(fbsDir, fileName, text, opts = {}) {
  const { backup = true, quiet = false, skipIfUnchanged = true } = opts;
  const outPath = resolveFbsJsonPath(fbsDir, fileName);
  const payload = String(text ?? '');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const current = tryReadText(outPath);
  if (skipIfUnchanged && current === payload) {
    if (!quiet) console.log(`[safe-fbs-json-write] 跳过未变化写入: ${outPath}`);
    return { path: outPath, changed: false, skipped: true };
  }

  const tmp = `${outPath}.tmp.${process.pid}`;
  const bak = `${outPath}.bak`;
  if (backup && fs.existsSync(outPath)) {
    try {
      fs.copyFileSync(outPath, bak);
    } catch (e) {
      if (!quiet) console.warn('[safe-fbs-json-write] 备份 .bak 失败:', e.message);
    }
  }

  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, outPath);
  return { path: outPath, changed: true, skipped: false };
}

/**
 * @param {string} fbsDir
 * @param {string} fileName
 * @param {object} obj 可 JSON.stringify 的对象
 * @param {{ backup?: boolean, quiet?: boolean, skipIfUnchanged?: boolean }} [opts]
 * @returns {{ path: string, changed: boolean, skipped: boolean }}
 */
export function writeJsonAtomic(fbsDir, fileName, obj, opts = {}) {
  const { backup = true, quiet = false, skipIfUnchanged = true } = opts;
  const outPath = resolveFbsJsonPath(fbsDir, fileName);
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('safe-fbs-json-write: 根类型须为 JSON object');
  }
  const payload = `${JSON.stringify(obj, null, 2)}\n`;

  return writeTextAtomic(fbsDir, fileName, payload, { backup, quiet, skipIfUnchanged });
}
