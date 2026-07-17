/**
 * node-env-check.mjs — Node.js 环境检测模块
 * FBS-BookWriter v2.0.3 | [B2] WorkBuddy 宿主适配
 *
 * 解决问题：WorkBuddy 内置 Node.js 不注入系统 PATH，
 * spawn('node', ...) 会静默失败；改用 process.execPath 可靠定位。
 *
 * 导出：
 *   checkNodeEnv(minVersion?)  → { ok, version, execPath, error? }
 *   resolveNodeExecPath()      → string（当前进程 Node 可执行绝对路径）
 *   assertNodeEnv(minVersion?) → void（版本不足时 throw）
 */

/** 解析 semver 字符串为数字三元组 */
function parseSemver(str) {
  const m = String(str).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** 比较两个 semver 三元组，a >= b 返回 true */
function semverGte(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

/**
 * 检查当前 Node.js 环境
 * @param {string} [minVersion='18.0.0'] 最低版本要求
 * @returns {{ ok: boolean, version: string, execPath: string, error?: string }}
 */
export function checkNodeEnv(minVersion = '18.0.0') {
  const version = process.version;
  const execPath = process.execPath;
  const current = parseSemver(version);
  const required = parseSemver(minVersion);

  if (!semverGte(current, required)) {
    return {
      ok: false,
      version,
      execPath,
      error: `Node.js ${version} 低于最低要求 ${minVersion}，部分脚本功能将降级为对话模式。`
    };
  }

  return { ok: true, version, execPath };
}

/**
 * 返回当前进程的 Node.js 可执行文件绝对路径。
 * 在 WorkBuddy 宿主中等同于内置 Node 路径，
 * 可安全传入 spawn() 替代字符串 'node'。
 *
 * @returns {string}
 */
export function resolveNodeExecPath() {
  return process.execPath;
}

/**
 * 断言 Node.js 版本满足要求，否则抛出错误。
 * 适用于强依赖特定 Node 版本的脚本入口处。
 *
 * @param {string} [minVersion='18.0.0']
 * @throws {Error}
 */
export function assertNodeEnv(minVersion = '18.0.0') {
  const result = checkNodeEnv(minVersion);
  if (!result.ok) {
    throw new Error(result.error);
  }
}

// ── CLI 自测（直接执行时输出检测结果）──
if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const result = checkNodeEnv(process.argv[2] || '18.0.0');
  console.log(JSON.stringify(result, null, 2));
}
