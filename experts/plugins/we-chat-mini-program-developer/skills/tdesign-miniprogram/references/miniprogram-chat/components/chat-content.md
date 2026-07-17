# ChatContent 对话正文

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-chat-content": "tdesign-miniprogram/chat-content/chat-content"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/rIY05tmE8p4o)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 01组件类型

- 对大模型返回的 markdown 数据自动渲染。markdown 会内置调用 `t-chat-markdown` 渲染，同时可根据 role（user/assistant）切换样式。
- 用户发送的消息保持默认格式显示，纯文本会做 HTML 转义并用 rich-text 渲染；

**WXML** (`html`):
```html
<view class="chat-example">
<view class="title">用户内容纯文本支持HTML转义</view>
<view class="chat-example-block">
<t-chat-content content="{{userContent}}" role="user"></t-chat-content>
</view>
</view>

<view class="chat-example">
<view class="title">助手内容（Markdown）</view>
<view class="chat-example-block">
<t-chat-content content="{{assistantContent}}" role="assistant"></t-chat-content>
</view>
</view>

```

**JS** (`javascript`):
```javascript
// import { Lexer } from 'marked';
import markdownData from './mock.js';

// 创建Lexer实例时添加配置，禁用gfm规范中的缩进代码块
// const lexer = new Lexer({});

// const tokens = lexer.lex(markdownData);

Component({
data: {
userContent: {
type: 'text',
data: '这是用户发送的普通文本内容',
},
assistantContent: {
type: 'markdown',
data: markdownData,
},
},
methods: {},
});

```

**CSS** (`css`):
```css
.chat-example {
margin-bottom: 32rpx;
}

.chat-example-block {
padding: 32rpx;
background-color: var(--td-bg-color-container);
}

.title {
padding: 0 32rpx 32rpx;
font-size: 28rpx;
line-height: 44rpx;
color: var(--bg-color-demo-desc);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "shared",
"usingComponents": {
"t-chat-content": "tdesign-miniprogram/chat-content/chat-content"
}
}

```

**MOCK** (`javascript`):
```javascript
const mockMarkdownData = `# Markdown功能测试 (H1标题)

## 基础语法测试 (H2标题)

### 列表测试

- 无序列表项1
- 无序列表项2
- 缩进列表项1（4个空格缩进）
- 缩进列表项2（4个空格缩进）

1. 有序列表项1
2. 有序列表项2
1. 缩进有序列表项1（4个空格缩进）
2. 缩进有序列表项2（4个空格缩进）

### 代码块测试

\`\`\`javascript
// JavaScript 代码块
function greet(name) {
console.log(\`Hello, \${name}!\`);
}
greet('Markdown');
\`\`\`

### 其他元素

> 引用文本块
> 多行引用内容

**加粗文字** _斜体文字_ ~~删除线~~

这是一个链接 [TDesign](https://tdesign.tencent.com)。
`;

export default mockMarkdownData;

```

## API

### ChatContentProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| content | Object | - | 必需。聊天内容对象。TS 类型：`TdChatContentType ``interface TdChatContentType { type: 'text' \| 'markdown'; data: string; }`。详细类型定义 | Y |
| markdown-props | Object | - | marked 解析器的配置选项。TS 类型：`ChatMarkdownProps`，ChatMarkdown API Documents。详细类型定义 | N |
| role | String | - | 必需。消息角色，用于区分用户和助手的消息样式	。可选项：user/assistant/system | Y |
| status | String | - | 正文状态。可选项：error / '' | N |