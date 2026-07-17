---
name: design-to-code-workflows
description: 将 Figma 设计和截图转换为生产就绪的代码组件，内置无障碍性支持
---

# Design to Code 工作流程

本 skill 提供设计到代码转换的完整工作流程，通过 MCP 服务器的 3 个工具支持从 Figma 设计文件和截图生成 React、Svelte 或 Vue 组件。

## 可用的 MCP 工具

本插件通过 MCP 服务器提供以下 3 个工具：

### 1. `parse_figma` - 解析 Figma 设计

从 Figma JSON 导出中提取组件信息。

**输入参数**：
```json
{
  "json": "Figma JSON 导出内容（字符串格式）",
  "framework": "react | svelte | vue（默认: react）"
}
```

**返回内容**：
- `framework`: 目标框架
- `components`: 提取的组件列表（名称、类型、尺寸）
- `colors`: 设计中使用的颜色
- `typography`: 字体设置（字体族、大小、粗细）

**使用场景**：
- 从 Figma 导出 JSON 文件后解析设计结构
- 提取设计系统的颜色和字体信息
- 为代码生成准备组件规格

### 2. `analyze_screenshot` - 分析截图

分析 UI 截图的布局并提取 UI 元素。

**输入参数**：
```json
{
  "imagePath": "截图文件的路径",
  "framework": "react | svelte | vue（默认: react）"
}
```

**返回内容**：
- `framework`: 目标框架
- `layout`: 布局结构（类型、子元素列表）

**使用场景**：
- 从设计稿截图快速生成代码
- 逆向工程现有 UI
- 快速原型设计

**注意**：截图文件需要是可访问的本地路径。

### 3. `generate_component` - 生成组件代码

根据布局规格生成代码组件。

**输入参数**：
```json
{
  "layout": {
    "type": "容器类型（如 container）",
    "children": [
      { "type": "text", "content": "内容" },
      { "type": "button", "label": "标签" }
    ],
    "styles": { "key": "value" }  // 可选
  },
  "framework": "react | svelte | vue（默认: react）",
  "includeA11y": true  // 是否包含无障碍性特性（默认: true）
}
```

**返回内容**：
- `code`: 生成的组件代码
- `framework`: 使用的框架
- `a11yCompliant`: 是否符合无障碍性标准

**使用场景**：
- 从解析的 Figma 数据生成代码
- 从分析的截图生成代码
- 从自定义布局规格生成代码

## 完整工作流程

### 工作流程 1：Figma 设计转代码

**步骤 1：导出 Figma 设计**

引导用户：
1. 在 Figma 中打开设计文件
2. 选择要转换的 Frame 或 Component
3. 右键 → "Copy as" → "Copy as JSON"
4. 将 JSON 内容粘贴给你

**步骤 2：解析 Figma JSON**

使用 `parse_figma` 工具：
```javascript
const parsedDesign = await parse_figma({
  json: "用户粘贴的 JSON 内容",
  framework: "react"  // 或用户选择的框架
});
```

**步骤 3：生成组件代码**

使用解析结果生成代码：
```javascript
const component = await generate_component({
  layout: parsedDesign.components[0],
  framework: "react",
  includeA11y: true
});
```

**步骤 4：优化和调整**

- 显示生成的代码
- 询问用户是否需要调整
- 可以添加样式、状态管理、交互逻辑
- 确保无障碍性特性完整

**输出**：生产就绪的 React/Svelte/Vue 组件，包含：
- 语义化 HTML
- ARIA 标签
- 键盘导航支持
- 适当的样式

---

### 工作流程 2：截图转代码

**步骤 1：获取截图**

引导用户：
1. 提供 UI 截图的路径
2. 或上传截图文件
3. 确认要使用的框架

**步骤 2：分析截图布局**

使用 `analyze_screenshot` 工具：
```javascript
const analysis = await analyze_screenshot({
  imagePath: "/path/to/screenshot.png",
  framework: "svelte"
});
```

**步骤 3：生成组件代码**

基于分析结果生成代码：
```javascript
const component = await generate_component({
  layout: analysis.layout,
  framework: "svelte",
  includeA11y: true
});
```

**步骤 4：完善组件**

- 检查生成的代码
- 添加缺失的交互逻辑
- 优化响应式布局
- 验证无障碍性

**输出**：可用的组件代码，基于截图中的视觉设计。

---

### 工作流程 3：自定义布局生成

**步骤 1：理解需求**

询问用户想要创建什么类型的组件：
- 表单组件
- 导航栏
- 卡片布局
- 模态框
- 等等

**步骤 2：定义布局规格**

根据需求构建布局对象：
```javascript
const layout = {
  type: "container",
  children: [
    {
      type: "header",
      content: "标题"
    },
    {
      type: "form",
      children: [
        { type: "input", label: "用户名", name: "username" },
        { type: "input", label: "密码", name: "password", inputType: "password" },
        { type: "button", label: "登录", action: "submit" }
      ]
    }
  ],
  styles: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem"
  }
};
```

**步骤 3：生成组件**

```javascript
const component = await generate_component({
  layout: layout,
  framework: "react",
  includeA11y: true
});
```

**步骤 4：迭代优化**

- 根据反馈调整布局
- 添加样式细节
- 实现业务逻辑
- 测试无障碍性

---

## 支持的框架

### React
- JSX 语法
- Hooks（useState, useEffect 等）
- 函数式组件
- TypeScript 支持（可选）

### Svelte
- 单文件组件
- 响应式声明
- 简洁的语法
- 内置状态管理

### Vue
- Composition API
- `<template>` + `<script>` + `<style>`
- 响应式数据
- TypeScript 支持（可选）

---

## 无障碍性特性

所有生成的组件默认包含以下无障碍性特性（`includeA11y: true`）：

### 1. ARIA 标签
- `aria-label`: 为屏幕阅读器提供描述
- `aria-labelledby`: 关联标签元素
- `aria-describedby`: 提供额外描述
- `role`: 明确元素角色

### 2. 语义化 HTML
- 使用正确的 HTML 元素（`<button>` 而非 `<div onclick>`）
- 表单元素正确关联 `<label>`
- 标题层级结构（`<h1>` → `<h6>`）
- 列表使用 `<ul>`/`<ol>`

### 3. 键盘导航
- Tab 顺序合理
- 焦点状态可见
- Enter/Space 触发按钮
- Esc 关闭模态框

### 4. 颜色对比
- 检查文本和背景的对比度
- 确保符合 WCAG AA 标准（4.5:1）
- 提示对比度不足的情况

---

## 使用最佳实践

### 1. Figma 导出建议

**✅ 推荐做法**：
- 导出前命名清晰的 Frame/Component
- 使用 Auto Layout（自动布局）
- 定义颜色和文本样式
- 组件化设计（避免扁平化）

**❌ 避免**：
- 过度嵌套的图层
- 未命名的元素
- 绝对定位（不利于响应式）
- 位图文本（应用文本图层）

### 2. 截图分析建议

**✅ 推荐做法**：
- 高分辨率截图（至少 1920x1080）
- 清晰的 UI 边界
- 完整的组件截图（不要裁剪关键部分）
- 单一组件或页面

**❌ 避免**：
- 模糊或低分辨率图片
- 包含多个无关元素
- 部分截图或不完整的 UI
- 复杂的全屏截图（建议拆分）

### 3. 框架选择建议

**React**：
- 企业级应用
- 需要丰富的生态系统
- 团队熟悉 JSX
- 需要 TypeScript 支持

**Svelte**：
- 性能要求高
- 喜欢简洁的语法
- 中小型项目
- 减少打包体积

**Vue**：
- 渐进式采用
- 团队熟悉模板语法
- 需要官方路由和状态管理
- 平衡的学习曲线

### 4. 代码生成后的优化

生成的代码是起点，建议：
- ✅ 添加具体的样式（CSS/Tailwind/CSS-in-JS）
- ✅ 实现交互逻辑和状态管理
- ✅ 添加数据验证
- ✅ 优化性能（懒加载、memo）
- ✅ 添加错误处理
- ✅ 编写单元测试

---

## 故障排除

### Figma JSON 解析失败

**原因**：
- JSON 格式不正确
- 不是 Figma 的 JSON 导出格式
- JSON 过大或包含特殊字符

**解决方法**：
1. 确认从 Figma "Copy as JSON" 复制
2. 检查 JSON 是否完整
3. 尝试导出更小的组件

### 截图分析不准确

**原因**：
- 截图分辨率太低
- UI 元素边界不清晰
- 包含过多元素

**解决方法**：
1. 提供更高分辨率的截图
2. 截取单个组件而非整页
3. 手动调整生成的布局规格

### 生成的代码需要调整

这是正常的！生成的代码是基础模板，需要：
- 添加业务逻辑
- 调整样式细节
- 优化响应式布局
- 添加状态管理

---

## 高级用法

### 批量转换

对于多个 Figma 组件：
1. 逐个导出 JSON
2. 批量解析
3. 统一生成组件
4. 组织成组件库

### 设计系统提取

从 Figma 设计文件提取：
- 颜色变量
- 字体样式
- 间距系统
- 组件规范

使用 `parse_figma` 的返回值：
```javascript
const { colors, typography } = await parse_figma({ json, framework });
// colors: ['#000000', '#FFFFFF', ...]
// typography: [{ family: 'Inter', size: 16, weight: 400 }, ...]
```

创建设计令牌（Design Tokens）文件。

### 响应式布局

在 `layout.styles` 中定义响应式样式：
```javascript
{
  layout: {
    type: "container",
    styles: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
      gap: "1rem"
    }
  }
}
```

### TypeScript 支持

生成 TypeScript 组件（React/Vue）：
1. 在生成后手动添加类型
2. 或在提示中明确要求 TypeScript 语法

---

## 限制和注意事项

1. **MCP 服务器需要配置**：插件依赖 MCP 服务器，需要正确配置 `.mcp.json`
2. **简化的实现**：当前工具提供基础的解析和生成，复杂设计可能需要手动调整
3. **截图分析限制**：基于图像的分析可能不如 Figma JSON 准确
4. **无障碍性基础**：生成的无障碍性特性是基础级别，复杂交互需要额外优化
5. **样式提取有限**：颜色和字体提取是简化的，详细样式需手动添加

---

## 相关资源

- **Figma API 文档**: https://www.figma.com/developers/api
- **React 文档**: https://react.dev
- **Svelte 文档**: https://svelte.dev
- **Vue 文档**: https://vuejs.org
- **WCAG 无障碍性指南**: https://www.w3.org/WAI/WCAG21/quickref/
- **ARIA 最佳实践**: https://www.w3.org/WAI/ARIA/apg/

---

## 工作流程总结

| 工作流程 | 输入 | MCP 工具 | 输出 |
|---------|------|---------|------|
| **Figma 转代码** | Figma JSON | `parse_figma` → `generate_component` | 生产就绪组件 |
| **截图转代码** | UI 截图 | `analyze_screenshot` → `generate_component` | 基础组件代码 |
| **自定义生成** | 布局规格 | `generate_component` | 定制化组件 |

所有工作流程都支持 React、Svelte、Vue 三种框架，并默认包含无障碍性特性。
