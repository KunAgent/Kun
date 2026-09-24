/**
 * Default user template for one-shot paper interpretation. Stored in
 * `write.paperReading.interpretTemplate`; an empty string means "use this
 * default". The host prompt builder wraps it with facts (paths, naming
 * contract, language) — the template itself only carries reading preferences.
 */
export const DEFAULT_PAPER_INTERPRET_TEMPLATE = `请帮我从以下几个方面观察这篇论文：
## 论文大概
## 论文提出的问题
## 论文的解决办法
## 实验
## 总结

然后创建一个 Markdown 文件，详细讲解这篇论文，写成一篇通俗易懂的讲解文章。
- 把论文里的关键图片抽出来放进文章，配合讲解（优先使用 figures/ 下已经抽好的图）。
- 对重点、难点、不容易理解的地方，用 Excalidraw 白板画图辅助讲解：
  每张图自己创建一个白板，白板名字用"文件名-图片名"；画好后用白板导出 PNG，放进文章对应的位置。`

export const PAPER_INTERPRET_TEMPLATE_MAX_CHARS = 8_000
export const PAPER_PAPERS_DIR_MAX_CHARS = 120
