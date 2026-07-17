/**
 * 书稿根目录下 git 工作区变更（供 session-exit / workbuddy-resume 钉住「改了哪些文件」）。
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

/**
 * @param {string} bookRoot
 * @returns {{ gitAvailable: boolean, changedFiles: string[], porcelainLines: string[], hint: string }}
 */
export function getGitWorkspaceChanges(bookRoot) {
  const root = path.resolve(bookRoot);
  const gitDir = path.join(root, ".git");
  if (!fs.existsSync(gitDir)) {
    return {
      gitAvailable: false,
      changedFiles: [],
      porcelainLines: [],
      hint: "书稿根下无 .git：无法自动列出变更文件；请在会话摘要中人工记录本次修改列表。",
    };
  }
  const run = (args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
    if (r.status !== 0) return "";
    return String(r.stdout || "").trim();
  };
  const lines = (s) => (s ? s.split(/\r?\n/).filter(Boolean) : []);
  const unstaged = lines(run(["diff", "--name-only"]));
  const staged = lines(run(["diff", "--cached", "--name-only"]));
  const vsHead = lines(run(["diff", "--name-only", "HEAD"]));
  const untracked = lines(run(["ls-files", "--others", "--exclude-standard"]));
  const merged = [...new Set([...unstaged, ...staged, ...vsHead, ...untracked])].slice(0, 300);
  const porcelain = run(["status", "--porcelain"]);
  return {
    gitAvailable: true,
    changedFiles: merged,
    porcelainLines: porcelain ? porcelain.split(/\r?\n/).filter(Boolean).slice(0, 100) : [],
    hint:
      merged.length > 0
        ? "以下为 git 检测到的变更路径（相对仓库根）；退出前请核对。"
        : "git 未检测到工作区变更；若修改在未跟踪文件或子模块外，请以实际为准。",
  };
}
