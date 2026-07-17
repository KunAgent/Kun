/**
 * P1 B3：记忆访问门面（统一本书真值 vs 宿主记忆 的调用边界）
 * 当前为薄封装，后续可替换为外部向量库而不改上层脚本。
 */
import { applyBookMemoryTemplate } from '../apply-book-memory-template.mjs';

/**
 * @param {string} bookRoot
 */
export function createBookMemoryAdapter(bookRoot) {
  const root = bookRoot;
  return {
    bookRoot: root,
    /** 刷新 session-resume-brief 等模板工件 */
    refreshSessionBrief(options = {}) {
      return applyBookMemoryTemplate({ bookRoot: root, quiet: options.quiet !== false });
    },
    /** 权威：书稿侧路径说明 */
    authoritativePaths() {
      return {
        fbs: `${root}/.fbs`,
        smartMemory: `${root}/.fbs/smart-memory`,
        resumeCard: `${root}/.fbs/workbuddy-resume.json`,
      };
    },
  };
}
