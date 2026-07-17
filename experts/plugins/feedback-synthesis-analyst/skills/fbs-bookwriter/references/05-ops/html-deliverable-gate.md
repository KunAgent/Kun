# HTML 交付档位（D1 / D2 / D3）

**版本**：2.0 · **质量交叉引用**：[`quality-check.md`](../02-quality/quality-check.md) C0-5、[`book-level-consistency.md`](../02-quality/book-level-consistency.md) §10

## 定义

| 档位 | 含义 | 条件摘要 |
|------|------|----------|
| **D1** | 专业 HTML 终稿 | 由技能包 `assets/build.mjs` 构建；`npm install` 含脚注相关链；S5 交付完成且 **`html-delivery-smoke.mjs --strict --fail-on-warn`** 退出码 0 |
| **D2** | 纯 MD 或可编辑 HTML | 无完整构建链时的诚实声明 |
| **D3** | 会话内草稿 HTML | **禁止**冒充 D1 |

## 命令

```bash
node scripts/html-delivery-smoke.mjs --html <路径.html> --strict --fail-on-warn
```

无 Node 时须在交付说明中**显式降级**为 D2。

## 检查项

### D1 必须通过

| 检查项 | 说明 | 工具 |
|--------|------|------|
| HTML 合法性 | 无解析错误 | `html-delivery-smoke.mjs` |
| 脚注渲染 | `markdown-it-footnote` 正确生成 | 目视检查 |
| CSS 完整 | 内联或链接样式表有效 | 目视检查 |
| Mermaid 渲染 | 图表正确显示 | 目视检查 |
| 链接有效 | 无死链 | `--strict` 模式 |
| 页面结构 | h1/h2/h3 层级正确 | `--fail-on-warn` |
| 破折号密度 | C0-1 总账合规 | `--strict` 模式 |

### D2 最低要求

- [ ] HTML 可在浏览器正常打开
- [ ] 图片正常显示
- [ ] 无明显布局错误
- [ ] 文件头标注「D2 降级交付」

### D3 限制

- 仅限内部传递使用
- **禁止**对外声明为「已完成 HTML 交付」
- 须在文件头标注「草稿版，非终稿 HTML」
