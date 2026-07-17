# PPT Frontend - Vite Project

这是一个基于 Vite 的 PPT 演示前端项目，使用原生 JavaScript 和 Tailwind CSS 构建。

## 技术栈

- **Vite 7**: 现代化的前端构建工具
- **Tailwind CSS 3**: 实用优先的 CSS 框架
- **Vanilla JavaScript**: 原生 JavaScript (ES6+ 模块化)
- **PostCSS**: CSS 后处理器

## 项目结构

```
frontend/
├── index.html                  # 主页面入口
├── 404.html                    # 404 错误页面
├── package.json               # 项目依赖配置
├── vite.config.js             # Vite 配置（多页面入口）
├── tailwind.config.js         # Tailwind CSS 配置
├── postcss.config.js          # PostCSS 配置
├── public/                    # 静态资源目录
└── src/
    ├── main.js                # JavaScript 主入口
    ├── styles/
    │   ├── main.css           # 主样式文件（含 Tailwind 指令）
    │   └── unified-styles.css # 统一样式（幻灯片通用样式）
    ├── js/
    │   ├── ppt-controller.js  # PPT 控制器（导航、动画、事件）
    │   └── route-handler.js   # 路由处理器（404 重定向）
    └── data/
        ├── slide-1.js         # 第 1 页幻灯片内容
        ├── slide-2.js         # 第 2 页幻灯片内容
        └── ...                # 更多幻灯片
```

## 开发命令

### 安装依赖
```bash
npm install
# 或
yarn install
```

### 启动开发服务器
```bash
npm run dev
```

### 构建生产版本
```bash
npm run build
```
构建产物输出到 `dist/` 目录，包含：
- `dist/index.html` - 主页面
- `dist/404.html` - 404 页面
- `dist/assets/` - 静态资源（JS、CSS）

### 预览生产构建
```bash
npm run preview
```

## 功能特性

### 📊 PPT 核心功能
- ✅ 幻灯片切换动画（淡入淡出）
- ✅ 键盘导航支持（← → 空格键 Home End）
- ✅ 触摸滑动支持（移动端）
- ✅ 进度条实时显示
- ✅ 页码指示器（1 / 10 或 "制作中"）
- ✅ 响应式设计（16:9 比例自适应屏幕）
- ✅ 键盘提示（3 秒后自动隐藏）

### 🎨 样式与设计
- ✅ Tailwind CSS 集成（原子化 CSS）
- ✅ CSS 变量主题系统（可配置颜色）
- ✅ 统一样式库（unified-styles.css）
- ✅ Google Fonts（Noto Sans SC）

### 🔧 开发体验
- ✅ 模块化 JavaScript（ES6 Modules）
- ✅ 热模块替换（HMR）
- ✅ 多页面构建（index + 404）
- ✅ 404 页面自动处理

## 架构说明

### 幻灯片数据管理

幻灯片内容存储在 `src/data/slide-N.js` 文件中，每个文件对应一页：

```javascript
// src/data/slide-1.js
window.slideDataMap.set(1, `
  <div class="cover-wrapper relative w-[1440px] h-[810px]">
    <!-- 幻灯片 HTML 内容 -->
  </div>
`);
```

**加载机制：**
1. `index.html` 中通过 `<script type="module">` 加载所有 slide-N.js
2. 每个文件向全局 `window.slideDataMap` 注册内容
3. `PPTController` 从 `slideDataMap` 读取并动态渲染

**空状态处理：**
- 当 `slideDataMap.size === 0` 时，页码显示 "制作中"
- 导航按钮禁用，进度条为 0%

### 主题颜色系统

在 `index.html` 中通过 CSS 变量定义主题：

```html
<style>
  :root {
    --primary-color: {{PRIMARY_COLOR}};
    --accent-color-1: {{ACCENT_COLOR_1}};
    --accent-color-2: {{ACCENT_COLOR_2}};
    --neutral-color: {{NEUTRAL_COLOR}};
  }
</style>
```

这些占位符可在构建时被替换为实际颜色值。

### 404 路由处理

**开发环境：**
- `route-handler.js` 检测无效路由（不在 `validRoutes` 列表中）
- 自动重定向到 `/404.html`

**生产环境：**
- Vite 多页面配置构建 `404.html`
- 服务器配置返回 404 页面（见下方部署配置）

## 自定义开发

### 添加新幻灯片

1. 创建新文件 `src/data/slide-N.js`：
```javascript
window.slideDataMap.set(N, `
  <div class="w-[1440px] h-[810px] bg-white p-20">
    <h1 class="text-6xl font-bold">新幻灯片标题</h1>
    <!-- 更多内容 -->
  </div>
`);
```

2. 在 `index.html` 的加载区域添加：
```html
<!--  开始加载slide-N.js区域 -->
<script type="module" src="/src/data/slide-N.js"></script>
<!--  结束加载slide-N.js区域 -->
```

### 修改主题颜色

替换 `index.html` 中的颜色占位符：
```css
--primary-color: #3B82F6;      /* 主色调 */
--accent-color-1: #10B981;     /* 强调色 1 */
--accent-color-2: #8B5CF6;     /* 强调色 2 */
--neutral-color: #6B7280;      /* 中性色 */
```

### 自定义 404 页面

编辑 `404.html`，修改样式、文案或交互逻辑。

### 添加新路由

在 `src/js/route-handler.js` 中添加有效路由：
```javascript
this.validRoutes = ['/', '/index.html', '/your-new-route']
```

## 部署配置

### Nginx

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /path/to/dist;
    index index.html;

    # 404 回退
    error_page 404 /404.html;
    
    location / {
        try_files $uri $uri/ /404.html;
    }
}
```

### Vercel

创建 `vercel.json`：
```json
{
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "status": 404, "dest": "/404.html" }
  ]
}
```

### Netlify

创建 `_redirects` 文件：
```
/*  /index.html  200
```

### 静态服务器

确保服务器配置在找不到文件时返回 `404.html`。

## 技术细节

### Vite 配置

- **端口**: 5173（默认）
- **Host**: `::` (IPv6，兼容 IPv4)
- **CORS**: 已启用
- **多页面入口**: `index.html` + `404.html`

### Tailwind 配置

- **内容扫描**: `index.html` + `src/**/*.{js,ts,jsx,tsx}`
- **JIT 模式**: 按需生成样式

### 浏览器兼容性

支持所有现代浏览器：
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## 常见问题

**Q: 为什么页码显示"制作中"？**  
A: `slideDataMap` 为空，没有加载任何幻灯片数据。检查 `src/data/` 目录和 `index.html` 的 script 标签。

**Q: 如何修改 PPT 尺寸？**  
A: 修改 `src/styles/main.css` 中的 `.ppt-viewport` 宽高（默认 1440x810px，16:9）。

**Q: 热更新不工作？**  
A: 检查 Vite 版本和浏览器控制台错误。确保使用 `npm run dev` 启动。

**Q: 构建后样式丢失？**  
A: 确保 Tailwind 的 `content` 配置包含所有使用 Tailwind 类的文件。

## 许可证

MIT
