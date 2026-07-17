# Design to Code 插件

将 Figma 设计文件和 UI 截图转换为生产就绪的代码组件，内置无障碍性支持。

## 安装

本插件为 CB Teams Marketplace 的一部分，通过团队配置自动安装。

**注意**：本插件依赖 MCP 服务器，需要配置 `.mcp.json` 文件。

## 核心能力

### 1. Figma 设计转代码

从 Figma JSON 导出中提取组件信息并生成代码。

**支持提取**：
- 组件结构（名称、类型、尺寸）
- 颜色系统
- 字体设置（字体族、大小、粗细）

**生成内容**：
- React JSX 组件（带 hooks）
- Svelte 单文件组件
- Vue Composition API 组件

### 2. 截图转代码

分析 UI 截图的布局并生成对应的代码组件。

**适用场景**：
- 快速原型设计
- 逆向工程现有 UI
- 从设计稿快速生成代码
- 快速验证设计可行性

### 3. 自定义组件生成

根据自定义的布局规格生成代码组件。

**适用场景**：
- 标准 UI 模式（表单、卡片、导航等）
- 自定义布局需求
- 组件库开发
- 设计系统实现

### 4. 内置无障碍性支持

所有生成的组件默认包含完整的无障碍性特性。

**包含特性**：
- ✅ ARIA 标签（screen reader 支持）
- ✅ 语义化 HTML（正确的元素使用）
- ✅ 键盘导航（Tab 顺序、焦点状态）
- ✅ 颜色对比检查（WCAG AA 标准）

## MCP 工具

本插件通过 `design-converter` MCP 服务器提供 3 个工具：

### 1. `parse_figma`

**功能**：解析 Figma JSON 导出

**输入参数**：
```json
{
  "json": "Figma JSON 导出内容",
  "framework": "react | svelte | vue"
}
```

**返回内容**：
- 组件列表（名称、类型、尺寸）
- 颜色数组
- 字体设置

### 2. `analyze_screenshot`

**功能**：分析 UI 截图布局

**输入参数**：
```json
{
  "imagePath": "截图文件路径",
  "framework": "react | svelte | vue"
}
```

**返回内容**：
- 布局结构
- UI 元素列表

### 3. `generate_component`

**功能**：生成代码组件

**输入参数**：
```json
{
  "layout": {
    "type": "container",
    "children": [...],
    "styles": {...}
  },
  "framework": "react | svelte | vue",
  "includeA11y": true
}
```

**返回内容**：
- 生成的组件代码
- 使用的框架
- 无障碍性合规标识

## 支持的框架

| 框架 | 语法 | 特点 |
|------|------|------|
| **React** | JSX + Hooks | 企业级应用、丰富生态、TypeScript 支持 |
| **Svelte** | 单文件组件 | 高性能、简洁语法、小体积 |
| **Vue** | Composition API | 渐进式、模板语法、官方工具链 |

## 使用场景示例

### 场景 1：从 Figma 设计生成登录表单

**用户操作**：
1. 在 Figma 中设计登录表单
2. 选择 Frame → 右键 → "Copy as" → "Copy as JSON"
3. 将 JSON 内容粘贴给 AI

**AI 执行**：
```javascript
// 步骤 1: 解析 Figma JSON
const parsed = await parse_figma({
  json: "用户粘贴的 JSON 内容",
  framework: "react"
});

// 步骤 2: 生成组件
const component = await generate_component({
  layout: parsed.components[0],
  framework: "react",
  includeA11y: true
});
```

**产出**：
```jsx
import React from 'react';

export default function LoginForm() {
  return (
    <form role="form" aria-label="登录表单">
      <div>
        <label htmlFor="username">用户名</label>
        <input 
          id="username" 
          type="text" 
          aria-required="true"
        />
      </div>
      <div>
        <label htmlFor="password">密码</label>
        <input 
          id="password" 
          type="password" 
          aria-required="true"
        />
      </div>
      <button type="submit" aria-label="提交登录">
        登录
      </button>
    </form>
  );
}
```

### 场景 2：从截图生成导航栏

**用户操作**：
1. 提供导航栏截图路径或上传截图
2. 指定使用 Svelte 框架

**AI 执行**：
```javascript
// 步骤 1: 分析截图
const analysis = await analyze_screenshot({
  imagePath: "/path/to/navbar.png",
  framework: "svelte"
});

// 步骤 2: 生成组件
const component = await generate_component({
  layout: analysis.layout,
  framework: "svelte",
  includeA11y: true
});
```

**产出**：
```svelte
<nav role="navigation" aria-label="主导航">
  <ul>
    <li><a href="/" aria-current="page">首页</a></li>
    <li><a href="/about">关于</a></li>
    <li><a href="/contact">联系</a></li>
  </ul>
</nav>

<style>
  nav {
    display: flex;
    padding: 1rem;
  }
  
  ul {
    display: flex;
    gap: 2rem;
    list-style: none;
  }
</style>
```

### 场景 3：自定义生成产品卡片

**用户需求**：
"我需要一个产品卡片组件，包含图片、标题、价格和购买按钮"

**AI 执行**：
```javascript
const layout = {
  type: "card",
  children: [
    { type: "image", src: "placeholder", alt: "产品图片" },
    { type: "heading", level: 3, content: "产品名称" },
    { type: "text", content: "¥99.00", className: "price" },
    { type: "button", label: "立即购买", action: "purchase" }
  ],
  styles: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    padding: "1.5rem",
    border: "1px solid #ddd",
    borderRadius: "8px"
  }
};

const component = await generate_component({
  layout,
  framework: "vue",
  includeA11y: true
});
```

**产出**：
```vue
<template>
  <article class="product-card" role="article">
    <img :src="product.image" :alt="product.name" />
    <h3>{{ product.name }}</h3>
    <p class="price" aria-label="价格">{{ product.price }}</p>
    <button 
      @click="handlePurchase" 
      aria-label="购买产品"
    >
      立即购买
    </button>
  </article>
</template>

<script setup>
import { ref } from 'vue';

const product = ref({
  image: '/placeholder.jpg',
  name: '产品名称',
  price: '¥99.00'
});

const handlePurchase = () => {
  // 购买逻辑
};
</script>

<style scoped>
.product-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  border: 1px solid #ddd;
  border-radius: 8px;
}
</style>
```

## 工作流程

### 完整的 Figma 到代码流程

```
1. 用户在 Figma 中设计
   ↓
2. 导出为 JSON (Copy as JSON)
   ↓
3. AI 使用 parse_figma 解析
   ↓
4. AI 使用 generate_component 生成代码
   ↓
5. 用户审查和优化代码
   ↓
6. 添加业务逻辑和样式细节
```

### 完整的截图到代码流程

```
1. 用户提供 UI 截图
   ↓
2. AI 使用 analyze_screenshot 分析
   ↓
3. AI 使用 generate_component 生成代码
   ↓
4. 用户审查和调整布局
   ↓
5. 完善交互逻辑和响应式设计
```

## 最佳实践

### Figma 导出建议

**✅ 推荐做法**：
- 使用 Auto Layout（自动布局）
- 为 Frame 和 Component 命名清晰
- 定义颜色和文本样式
- 组件化设计（避免扁平化）

**❌ 避免**：
- 过度嵌套的图层
- 未命名的元素
- 绝对定位（不利于响应式）
- 位图文本

### 截图质量建议

**✅ 推荐**：
- 高分辨率（至少 1920x1080）
- 清晰的 UI 边界
- 完整的组件截图
- 单一组件或页面

**❌ 避免**：
- 模糊或低分辨率
- 包含多个无关元素
- 部分截图或不完整的 UI

### 框架选择建议

| 场景 | 推荐框架 | 原因 |
|------|---------|------|
| 企业级应用 | React | 生态丰富、TypeScript 支持 |
| 性能要求高 | Svelte | 编译时优化、小体积 |
| 渐进式采用 | Vue | 学习曲线平缓、官方工具链 |
| 小型项目 | Svelte | 简洁、快速 |
| 需要 SSR | React/Vue | Next.js / Nuxt.js |

### 代码优化建议

生成的代码是起点，建议：

1. **添加样式**：
   - CSS Modules
   - Tailwind CSS
   - styled-components
   - CSS-in-JS

2. **状态管理**：
   - React: useState, useReducer, Zustand, Redux
   - Svelte: stores
   - Vue: ref, reactive, Pinia

3. **数据验证**：
   - 表单验证
   - 输入清理
   - 错误处理

4. **性能优化**：
   - 懒加载
   - Code splitting
   - Memoization
   - Virtual scrolling

5. **测试**：
   - 单元测试
   - 集成测试
   - 无障碍性测试

## 无障碍性最佳实践

### ARIA 标签使用

```jsx
// ✅ 正确
<button aria-label="关闭对话框" onClick={close}>
  <CloseIcon />
</button>

// ❌ 错误（图标按钮没有标签）
<button onClick={close}>
  <CloseIcon />
</button>
```

### 语义化 HTML

```jsx
// ✅ 正确
<nav>
  <ul>
    <li><a href="/">首页</a></li>
  </ul>
</nav>

// ❌ 错误（div 没有语义）
<div>
  <div onClick={goHome}>首页</div>
</div>
```

### 键盘导航

```jsx
// ✅ 正确
<div 
  role="button" 
  tabIndex={0}
  onKeyDown={(e) => e.key === 'Enter' && handleClick()}
  onClick={handleClick}
>
  点击
</div>

// ❌ 错误（无键盘支持）
<div onClick={handleClick}>点击</div>
```

### 颜色对比

- 文本和背景对比度至少 4.5:1（WCAG AA）
- 大文本（18pt+）至少 3:1
- 不依赖颜色传达信息

## 技术要求

### 依赖

- Node.js 18+
- TypeScript（用于 MCP 服务器）
- 支持的框架：React 18+、Svelte 4+、Vue 3+

### MCP 服务器配置

`.mcp.json` 示例：
```json
{
  "mcpServers": {
    "design-converter": {
      "command": "node",
      "args": ["dist/servers/design-converter.js"]
    }
  }
}
```

**注意**：需要先编译 TypeScript 文件到 `dist/` 目录。

## 限制和注意事项

1. **简化实现**：当前工具提供基础解析和生成，复杂设计需手动调整
2. **截图分析限制**：基于图像的分析可能不如 Figma JSON 准确
3. **样式提取有限**：颜色和字体提取是简化的，详细样式需手动添加
4. **MCP 服务器依赖**：必须正确配置 MCP 服务器才能使用
5. **无障碍性基础**：生成的 a11y 特性是基础级别，复杂交互需额外优化

## 故障排除

### MCP 服务器无法启动

**检查**：
- Node.js 版本是否 18+
- TypeScript 是否编译（`dist/` 目录存在）
- `.mcp.json` 配置是否正确

### Figma JSON 解析失败

**原因**：
- JSON 格式不正确
- 不是从 "Copy as JSON" 复制
- JSON 包含特殊字符

**解决**：
- 确认从 Figma 正确导出
- 检查 JSON 完整性
- 尝试导出更小的组件

### 截图分析不准确

**原因**：
- 分辨率太低
- UI 边界不清晰
- 包含过多元素

**解决**：
- 提供更高分辨率截图
- 截取单个组件而非整页
- 手动调整生成的布局

## Skills 列表

| Skill | 说明 |
|-------|------|
| **design-to-code-workflows** | 完整的设计到代码工作流程，包含 Figma 转代码、截图转代码和自定义生成的详细指导 |

## 相关资源

- **Figma API**: https://www.figma.com/developers/api
- **React**: https://react.dev
- **Svelte**: https://svelte.dev
- **Vue**: https://vuejs.org
- **WCAG 指南**: https://www.w3.org/WAI/WCAG21/quickref/
- **ARIA 最佳实践**: https://www.w3.org/WAI/ARIA/apg/

## License

MIT License
