# 模板已知缺陷（不影响交付但需知）

以下问题是 `assets/template.html` 本身的结构性错误，**不是生成者的操作失误**。遇到样式异常时先查此处。

---

## Issue A: `.h-xl` CSS 重复定义

**文件**：`assets/template.html`

**现象**：修改了 `h-xl` 的字号或样式但不生效。

**根因**：CSS 中 `h-xl` 出现在两处：
1. 通用字体区（`h-hero / h-xl / h-sub / h-md` 一起定义）
2. 组件区（`.h-xl` 单独重定义）

第二次定义覆盖第一次。

**临时解**：在 slide 内联 `style="font-size:..."` 覆盖。  
**根本解**：打开 `assets/template.html`，删除组件区那块重复的 `.h-xl{...}` 块，保留通用区一处即可。

**验证**：
```bash
grep -n '\.h-xl' ~/.agents/skills/guizang-ppt-skill/assets/template.html
# 应该只有 1 处定义；2 处 = 需修复
```

---

## Issue B: `motion.min.js` 文件完整性未验证

**文件**：`assets/motion.min.js`

**现象**：动画完全不触发，控制台无 Motion One 报错；本地测试时代码完全正确但翻页时内容"啪"一下全出，没有淡入。

**根因**：文件被截断（下载中断、编辑器保存失败等），但大小仍为数十 KB，肉眼不易察觉。

**自检**：
```bash
# 检查文件大小（应为 ~64KB）
ls -lh ~/.agents/skills/guizang-ppt-skill/assets/motion.min.js

# 验证结尾完整性（应为 "});" 完整结尾）
tail -c 20 ~/.agents/skills/guizang-ppt-skill/assets/motion.min.js | tr -d '\n'
# 输出应为 "});" 而非截断字符串
```

**修复**：重新从 CDN 下载
```bash
curl -sL https://unpkg.com/motion@10.18.0/dist/motion.min.js \
  > ~/.agents/skills/guizang-ppt-skill/assets/motion.min.js
```

---

## Issue C: Google Fonts CDN 在中国大陆无法访问

**影响**：字体 fallback 到系统默认，Playfair Display / Noto Serif SC 丢失，标题失去衬线感，变成宋体等系统 serif。

**适用场景**：观众/用户在中国大陆时。

**缓解方案**：

方案 1（改 CDN 域名）：
将 HTML 中所有 `https://fonts.googleapis.com` 替换为 `https://fonts.googleapis.cn`

方案 2（字体本地化）：
```bash
# 下载字体到 ppt 项目本地
mkdir -p ppt/fonts
curl -sL "https://fonts.gstatic.com/s/playfairdisplay/v36/..." -o fonts/PlayfairDisplay.woff2
# 在 HTML 中用 @font-face 引用本地文件
```

---

## Issue D: ESC 索引视图功能未实现

**文件**：`assets/template.html` 的 JS 部分

**现象**：`references/checklist.md` 的自检清单中提到"ESC 键触发索引视图"，但当前模板的 JS **完全没有实现此功能**。ESC 键目前没有任何行为。

**状态**：planned but not wired。

**处理**：在验收时忽略 checklist.md 中"ESC 键触发索引视图"这一项；不要在演示时尝试按 ESC。

---

## Issue E: WebGL 背景是 Canvas 2D 模拟，非真实 WebGL Shader

**文件**：`assets/template.html` 的 JS 画布部分

**现象**：SKILL.md 描述为"WebGL 流体背景"，但模板实际使用的是 **Canvas 2D 渐变动画**（drawDarkFluid / drawLightFluid 函数）。"流体/等高线/色散"等高端视觉效果不存在。

**影响**：如果用户期望的是真正 WebGL shader 级别的视觉，会失望。

**状态**：设计文档与实现不符，属于 feature drift。

**处理**：使用前对用户说明视觉风格为"Canvas 2D 动态渐变"，如果需要真实 WebGL shader，需另行实现。
