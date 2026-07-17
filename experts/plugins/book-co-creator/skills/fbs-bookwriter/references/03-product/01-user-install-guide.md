# npm 包按需安装指南

> **文档信息**
> - **名称**：user-install-guide.md
> - **描述**：npm 按需安装说明（可选依赖）
> - **归属**：references/03-product/
> - **导航**：[返回SKILL.md](../../SKILL.md) | [交付指南](../05-ops/delivery-guide.md) | [文档索引](../01-core/skill-index.md)

---

## 为什么改为用户自行安装？

本技能采用**零预装、按需安装**的设计理念，原因如下：

### 设计理由

1. **降低入门门槛**：新用户无需了解npm或Node.js生态，直接对话即可使用核心功能
2. **按需付费**：只有需要PDF、DOCX等高级输出时才安装对应依赖
3. **环境兼容**：避免跨平台npm依赖的兼容性问题（尤其是Windows下的node-gyp）
4. **持续可用**：不依赖本地环境的复杂安装，核心功能永远可用
5. **灵活升级**：用户可以自行选择最新版本的依赖

### 理念对比

| 对比项 | 旧模式（预装） | 新模式（按需） |
|--------|----------------|----------------|
| 首次使用 | 需完成完整安装环境 | 零配置即可使用 |
| 输出PDF | 内含 | 需自行安装 |
| 磁盘占用 | 大（>500MB依赖） | 小（按需） |
| 安装失败率 | 高 | 低（只有高级产物功能） |
| 核心功能可用性 | 依赖安装成功 | 100%可用 |

---

## 安装前检查清单

> **核心功能无需安装**：直接在 WorkBuddy / CodeBuddy 对话即可写书（Markdown 输出）。
> 以下检查仅适用于需要**本地 PDF / DOCX 构建**的用户。

### 仅有本地构建时需要

- [ ] **Node.js 版本**：运行 `node --version`，确认 ≥ 18.0.0
- [ ] **npm 版本**：运行 `npm --version`，确认 ≥ 9.0.0
- [ ] **网络连接**：安装过程需要下载包，确保网络畅通

### 可选

- [ ] **国内镜像**（中国大陆用户）：建议配置淘宝镜像加速
  ```bash
  npm config set registry https://registry.npmmirror.com
  ```

---

## 三方案对比

### PDF 输出方案

| 方案 | 安装命令 | 渲染质量 | 中文支持 | 安装难度 | 稳定性 |
|------|----------|----------|----------|----------|--------|
| **Playwright**（推荐） | 复杂 | ⭐⭐⭐⭐ | ✅ 完善 | 中 | 中 |
| **Puppeteer** | 简单 | ⭐⭐⭐⭐ | ✅ 完善 | 中 | 中 |
| **浏览器打印** | 无 | ⭐⭐⭐⭐ | ✅ 完善 | 低 | 100% |
| ReportLab | 简单 | ⭐⭐ | ⚠️ 需配置 | 中 | 中 |

**推荐决策树**：

```
需要PDF？
  ├── 是
  │   ├── 追求最佳效果？ → Playwright
  │   ├── 偶尔使用 → 浏览器打印（Ctrl+P，零配置）
  │   └── 已安装过Puppeteer → Puppeteer
  └── 否 → 无需安装任何npm包
```

### DOCX 输出方案

| 方案 | 安装命令 | 格式保真度 | 维护成本 | 推荐 |
|------|----------|------------|----------|------|
| **在线工具**（CloudConvert 等） | 无 | ⭐⭐⭐⭐ | 低 | ⭐⭐⭐⭐ |
| **Word / WPS**（HTML 用浏览器打开后另存，或粘贴） | 无 | ⭐⭐⭐ | 低 | ⭐⭐⭐ |
| **Pandoc**（若本机已装） | 视环境 | ⭐⭐⭐⭐ | 低 | ⭐⭐⭐ |
| html-to-docx | `npm i html-to-docx` | ⭐⭐⭐ | 中 | ⭐⭐ |

---

## 按功能模块安装指南

### 模块1：仅使用核心功能（Markdown 输出）

**适用场景**：
- 纯内创作
- 不需要本地PDF生成
- 不修改模板或代码

**安装命令**：
```bash
# 无需安装任何npm包
# 直接使用宿主（CodeBuddy / WorkBuddy 等）对话即可生成 Markdown
```

**验证方式**：
```
在 WorkBuddy 中说："帮我写一本关于XX的书"
AI 将输出完整的 Markdown 内容
```

---

### 模块2：HTML 输出

**适用场景**：
- 需要美化排版
- 需要 Mermaid 图表渲染
- 需要在浏览器中预览

**安装命令**：
```bash
# 本地 HTML 构建最低依赖：markdown-it + markdown-it-footnote
npm install markdown-it markdown-it-footnote
```

**不使用 npm的情况**：
- HTML 构建可选用任何静态站点工具或自行脚本；最小技能包不绑定仓库内 ops 目标
- 可以直接使用浏览器打开生成的 HTML

**验证方式**：
```
在对话中说：「生成 HTML 版本」或按 `delivery-guide.md` 指引构建
系统将输出完整的 HTML 文件
```

---

### 模块3：PDF 输出（Playwright 方案）

**适用场景**：
- 需要生成高质量 PDF
- 包含复杂图表和排版
- 对中文渲染有要求

**完整安装步骤**：

```bash
# 1. 安装 Playwright 核心
npm install playwright

# 2. 安装 Chromium 浏览器（约 250MB）
npx playwright install chromium

# 3. 安装系统依赖（Linux 需要，Windows 可跳过）
npx playwright install-deps
```

**故障排除**：

| 问题 | 解决方案 |
|------|----------|
| 下载慢 | 使用淘宝镜像：`npx playwright install chromium --mirror https://npmmirror.com/mirrors/playwright/` |
| 安装失败 | 尝试管理员权限运行终端 |
| Windows 缺依赖 | 安装 Visual C++ Redistributable |

**验证方式**：
```bash
# 进入项目目录
cd ./your-build-dir

# 构建环境检查（推荐）
node assets/build.mjs --check
```

---

### 模块4：PDF 输出（Puppeteer 方案）

**适用场景**：
- 之前使用过 Puppeteer
- 已安装过 chromium

**完整安装步骤**：

```bash
# 1. 安装 Puppeteer
npm install puppeteer

# 2. Puppeteer 会自动下载 chromium（约 150MB）
# 等待下载完成即可
```

**故障排除**：

| 问题 | 解决方案 |
|------|----------|
| chromium 下载超时 | 使用淘宝镜像：`PUPPETEER_DOWNLOAD_HOST=https://npm.taobao.org/mirrors npm install puppeteer` |
| 下载被阻 | 手动下载 chromium，解压后设置路径 |

**手动设置 chromium 路径**：
```javascript
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/path/to/chromium',  // 你的 chromium 路径
    headless: true
  });
  // ...
})();
```

---

### 模块5：DOCX 输出

**方案A：使用在线工具**

无需安装任何东西，可搜索 "HTML to DOCX online converter" 找到合适的在线转换服务，将助手生成的 HTML 文件上传后下载 DOCX。选择时注意：

- 隐私敏感内容建议使用本地方案（方案B）
- 不同在线工具格式保真度和免费额度不同，建议对比测试后选择

**方案B：html-to-docx（本地转换）**

```bash
# 安装
npm install html-to-docx
```

```javascript
// 使用示例
const { convert } = require('html-to-docx');
const fs = require('fs-extra');

async function convertToDocx(inputPath, outputPath) {
  const html = await fs.readFile(inputPath, 'utf-8');
  const buffer = await convert(html);
  await fs.writeFile(outputPath, buffer);
}
```

---

## 依赖版本参考

### 推荐版本组合

| 场景 | Node.js | npm | playwright | puppeteer |
|------|---------|-----|------------|-----------|
| 最小化 | 18+ | 9+ | 最新 | 最新 |
| 稳定性 | 20 LTS | 10+ | 1.40+ | 22+ |
| 中国镜像 | 任一 | 任一 | 任一 | 任一 |

### 版本兼容

- **Node.js < 16**：不支持，部分 ESM 特性不兼容
- **npm < 8**：不支持 workspace 特性
- **Playwright < 1.30**：部分 API 已废弃

---

## 常见问题 FAQ

### Q1：安装 npm 包时一直失败怎么办？

**A**：尝试以下步骤：

```bash
# 1. 清除 npm 缓存
npm cache clean --force

# 2. 使用淘宝镜像
npm config set registry https://registry.npmmirror.com

# 3. 重试安装
npm install <package-name>
```

### Q2：如何查看已安装的包？

```bash
# 查看全局安装的包
npm list -g --depth=0

# 查看项目依赖
npm list --depth=0
```

### Q3：如何完全卸载一个包？

```bash
# 卸载包
npm uninstall <package-name>

# 同时清理 node_modules 中的文件
rm -rf node_modules/<package-name>
```

### Q4：可以同时安装 Playwright 和 Puppeteer 吗？

**A**：可以，但会占用较多磁盘空间（约 400MB）。建议根据主要使用场景选择其中一个。

### Q5：安装后如何验证是否成功？

```bash
# 验证 Playwright
node -e "require('playwright'); console.log('Playwright OK')"

# 验证 Puppeteer
node -e "require('puppeteer'); console.log('Puppeteer OK')"
```

### Q6：如何更新已安装的包？

```bash
# 更新到最新版
npm install <package-name>@latest

# 更新到指定版
npm install <package-name>@1.40.0
```

### Q7：企业内网无法访问 npm 怎么办？

**A**：
1. 使用私有 npm 镜像（如 Verdaccio）
2. 或联系 IT 部门开通 npm 访问白名单
3. 或使用浏览器打印方案（零安装）

---

## 快速参考卡

```
┌──────────────────────────────────────────────────────────┐
│                FBS-BookWriter 安装决策                     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ 需要 PDF？                                               │
│   ├── 是 → 需要本地生成？                                 │
│   │      ├── 是 → Playwright 或 Puppeteer                │
│   │      └── 否 → 浏览器打印（Ctrl+P）                    │
│   │                                                      │
│   └── 否 → 需要 DOCX？                                   │
│          ├── 在线工具 / Word 另存 / Pandoc / html-to-docx │
│          └── 无需安装任何npm包                             │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 下一步

安装完成后，建议阅读：

1. [文档索引](../01-core/skill-index.md) - 环境与规范导览
2. [交付指南](../05-ops/delivery-guide.md) - 如何使用各种输出格式
3. [SKILL.md](../../SKILL.md) - 主技能文档，了解完整功能
