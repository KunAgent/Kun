/**
 * Node.js v24+：node:sqlite 首次使用会向 stderr 打印 ExperimentalWarning，污染 JSON/门禁输出。
 * 在 import node:sqlite 之前 side-effect import 本文件即可抑制与 SQLite 相关的一行告警。
 */
let installed = false;

export function installSuppressNodeSqliteExperimentalWarning() {
  if (installed) return;
  installed = true;
  const shouldSuppress = (s) => /ExperimentalWarning.*SQLite|SQLite is an experimental feature/i.test(String(s || ""));
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, encoding, cb) => {
    try {
      const s =
        typeof chunk === "string"
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString("utf8")
            : String(chunk ?? "");
      if (shouldSuppress(s)) {
        if (typeof cb === "function") process.nextTick(cb);
        return true;
      }
    } catch {
      // fall through to orig
    }
    return orig(chunk, encoding, cb);
  };

  // 某些 Node 版本会先触发 process.emitWarning，再落到 stderr；双保险过滤。
  const origEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = (warning, ...args) => {
    try {
      const msg =
        typeof warning === "string"
          ? warning
          : warning?.message || String(warning ?? "");
      if (shouldSuppress(msg)) return;
      if (args.length > 0 && shouldSuppress(args[0])) return;
    } catch {
      // fall through
    }
    return origEmitWarning(warning, ...args);
  };
}

installSuppressNodeSqliteExperimentalWarning();
