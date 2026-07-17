---
name: tdesign-miniprogram
description: "TDesign WeChat Mini Program UI component library by Tencent. Use when building WeChat mini apps with TDesign components (Button, Dialog, Input, Tabs, Chat, etc.), implementing TDesign design system, customizing themes/dark mode, or building AI chat interfaces in mini programs."
description_zh: "TDesign 微信小程序组件库（60+ 组件、主题定制、AI 聊天）"
description_en: "TDesign WeChat Mini Program UI components, themes & AI chat"
version: 1.0.0
homepage: https://tdesign.tencent.com/miniprogram/overview
allowed-tools: Read,Write,Bash
---

# TDesign Mini Program Skill

TDesign WeChat Mini Program component library, an enterprise-level design system by Tencent. Provides 60+ high-quality components with dark mode support, theme customization, and more.

## When to Use This Skill

This skill should be triggered when:

- Developing WeChat Mini Programs with TDesign component library
- Using TDesign UI components (Button, Input, Dialog, etc.)
- Implementing interfaces following TDesign design specifications
- Configuring TDesign themes and style customization
- Building AI chat interfaces (using TDesign Chat components)
- Implementing dark mode adaptation

## Quick Start

### Installation

```bash
npm i tdesign-miniprogram -S --production
```

### Modify app.json

Remove `"style": "v2"` from `app.json` to avoid style conflicts.

### Modify project.config.json

Add the following to the `setting` section of `project.config.json`:

```json
{
  "setting": {
    "packNpmManually": true,
    "packNpmRelationList": [
      {
        "packageJsonPath": "./package.json",
        "miniprogramNpmDistDir": "./"
      }
    ]
  }
}
```

### Modify tsconfig.json (TypeScript projects)

```json
{
  "paths": {
    "tdesign-miniprogram/*": [
      "./miniprogram/miniprogram_npm/tdesign-miniprogram/*"
    ]
  }
}
```

> After modifying project.config.json, build npm in WeChat DevTools: `Tools - Build npm`

> After successful build, check `Compile JS to ES5`

### Using Components

Import in page or component JSON file:

```json
{
  "usingComponents": {
    "t-button": "tdesign-miniprogram/button/button"
  }
}
```

Use in WXML:

```html
<t-button theme="primary">Button</t-button>
```

## Component Categories

### Basic Components (6)

| Component | Description            | Import Path                           |
| --------- | ---------------------- | ------------------------------------- |
| Button    | Button                 | `tdesign-miniprogram/button/button`   |
| Divider   | Divider                | `tdesign-miniprogram/divider/divider` |
| Fab       | Floating Action Button | `tdesign-miniprogram/fab/fab`         |
| Icon      | Icon                   | `tdesign-miniprogram/icon/icon`       |
| Layout    | Layout                 | `tdesign-miniprogram/row/row`         |
| Link      | Link                   | `tdesign-miniprogram/link/link`       |

### Navigation Components (8)

| Component | Description     | Import Path                             |
| --------- | --------------- | --------------------------------------- |
| BackTop   | Back to Top     | `tdesign-miniprogram/back-top/back-top` |
| Drawer    | Drawer          | `tdesign-miniprogram/drawer/drawer`     |
| Indexes   | Index List      | `tdesign-miniprogram/indexes/indexes`   |
| Navbar    | Navigation Bar  | `tdesign-miniprogram/navbar/navbar`     |
| SideBar   | Side Navigation | `tdesign-miniprogram/side-bar/side-bar` |
| Steps     | Steps           | `tdesign-miniprogram/steps/steps`       |
| TabBar    | Bottom Tab Bar  | `tdesign-miniprogram/tab-bar/tab-bar`   |
| Tabs      | Tabs            | `tdesign-miniprogram/tabs/tabs`         |

### Input Components (16)

| Component      | Description      | Import Path                                             |
| -------------- | ---------------- | ------------------------------------------------------- |
| Calendar       | Calendar         | `tdesign-miniprogram/calendar/calendar`                 |
| Cascader       | Cascader         | `tdesign-miniprogram/cascader/cascader`                 |
| CheckBox       | Checkbox         | `tdesign-miniprogram/checkbox/checkbox`                 |
| DateTimePicker | Date Time Picker | `tdesign-miniprogram/date-time-picker/date-time-picker` |
| Input          | Input            | `tdesign-miniprogram/input/input`                       |
| Picker         | Picker           | `tdesign-miniprogram/picker/picker`                     |
| Radio          | Radio            | `tdesign-miniprogram/radio/radio`                       |
| Rate           | Rate             | `tdesign-miniprogram/rate/rate`                         |
| Search         | Search           | `tdesign-miniprogram/search/search`                     |
| Slider         | Slider           | `tdesign-miniprogram/slider/slider`                     |
| Stepper        | Stepper          | `tdesign-miniprogram/stepper/stepper`                   |
| Switch         | Switch           | `tdesign-miniprogram/switch/switch`                     |
| Textarea       | Textarea         | `tdesign-miniprogram/textarea/textarea`                 |
| TreeSelect     | Tree Select      | `tdesign-miniprogram/tree-select/tree-select`           |
| Upload         | Upload           | `tdesign-miniprogram/upload/upload`                     |
| Form           | Form             | `tdesign-miniprogram/form/form`                         |

### Data Display Components (18)

| Component   | Description  | Import Path                                     |
| ----------- | ------------ | ----------------------------------------------- |
| Avatar      | Avatar       | `tdesign-miniprogram/avatar/avatar`             |
| Badge       | Badge        | `tdesign-miniprogram/badge/badge`               |
| Cell        | Cell         | `tdesign-miniprogram/cell/cell`                 |
| Collapse    | Collapse     | `tdesign-miniprogram/collapse/collapse`         |
| CountDown   | Countdown    | `tdesign-miniprogram/count-down/count-down`     |
| Empty       | Empty State  | `tdesign-miniprogram/empty/empty`               |
| Footer      | Footer       | `tdesign-miniprogram/footer/footer`             |
| Grid        | Grid         | `tdesign-miniprogram/grid/grid`                 |
| Image       | Image        | `tdesign-miniprogram/image/image`               |
| ImageViewer | Image Viewer | `tdesign-miniprogram/image-viewer/image-viewer` |
| Progress    | Progress     | `tdesign-miniprogram/progress/progress`         |
| Result      | Result       | `tdesign-miniprogram/result/result`             |
| Skeleton    | Skeleton     | `tdesign-miniprogram/skeleton/skeleton`         |
| Sticky      | Sticky       | `tdesign-miniprogram/sticky/sticky`             |
| Swiper      | Swiper       | `tdesign-miniprogram/swiper/swiper`             |
| Table       | Table        | `tdesign-miniprogram/table/table`               |
| Tag         | Tag          | `tdesign-miniprogram/tag/tag`                   |
| List        | List         | `tdesign-miniprogram/list/list`                 |

### Feedback Components (12)

| Component       | Description       | Import Path                                               |
| --------------- | ----------------- | --------------------------------------------------------- |
| ActionSheet     | Action Sheet      | `tdesign-miniprogram/action-sheet/action-sheet`           |
| Dialog          | Dialog            | `tdesign-miniprogram/dialog/dialog`                       |
| DropdownMenu    | Dropdown Menu     | `tdesign-miniprogram/dropdown-menu/dropdown-menu`         |
| Guide           | Guide             | `tdesign-miniprogram/guide/guide`                         |
| Loading         | Loading           | `tdesign-miniprogram/loading/loading`                     |
| Message         | Message           | `tdesign-miniprogram/message/message`                     |
| NoticeBar       | Notice Bar        | `tdesign-miniprogram/notice-bar/notice-bar`               |
| Overlay         | Overlay           | `tdesign-miniprogram/overlay/overlay`                     |
| Popup           | Popup             | `tdesign-miniprogram/popup/popup`                         |
| PullDownRefresh | Pull Down Refresh | `tdesign-miniprogram/pull-down-refresh/pull-down-refresh` |
| SwipeCell       | Swipe Cell        | `tdesign-miniprogram/swipe-cell/swipe-cell`               |
| Toast           | Toast             | `tdesign-miniprogram/toast/toast`                         |

### AI Chat Components (9)

| Component     | Description     | Import Path                                         |
| ------------- | --------------- | --------------------------------------------------- |
| ChatList      | Chat List       | `tdesign-miniprogram/chat-list/chat-list`           |
| ChatMessage   | Chat Message    | `tdesign-miniprogram/chat-message/chat-message`     |
| ChatSender    | Chat Sender     | `tdesign-miniprogram/chat-sender/chat-sender`       |
| ChatContent   | Chat Content    | `tdesign-miniprogram/chat-content/chat-content`     |
| ChatActionbar | Chat Action Bar | `tdesign-miniprogram/chat-actionbar/chat-actionbar` |
| ChatLoading   | Chat Loading    | `tdesign-miniprogram/chat-loading/chat-loading`     |
| ChatMarkdown  | Chat Markdown   | `tdesign-miniprogram/chat-markdown/chat-markdown`   |
| ChatThinking  | Chat Thinking   | `tdesign-miniprogram/chat-thinking/chat-thinking`   |
| Attachments   | Attachments     | `tdesign-miniprogram/attachments/attachments`       |

## Common Patterns

### Button

```html
<!-- Basic Buttons -->
<t-button theme="primary" size="large">Primary Button</t-button>
<t-button theme="light" size="large">Light Button</t-button>
<t-button size="large">Default Button</t-button>

<!-- Outline and Text Buttons -->
<t-button theme="primary" size="large" variant="outline"
  >Outline Button</t-button
>
<t-button theme="primary" size="large" variant="text">Text Button</t-button>

<!-- Icon Button -->
<t-button
  theme="primary"
  icon="app"
  content="Icon Button"
  size="large"
></t-button>

<!-- Loading State -->
<t-button theme="primary" size="large" loading>Loading</t-button>

<!-- Disabled State -->
<t-button theme="primary" size="large" disabled>Disabled</t-button>

<!-- Block Button -->
<t-button theme="primary" size="large" block>Block Button</t-button>

<!-- Ghost Button (transparent background) -->
<t-button theme="primary" ghost size="large">Ghost Button</t-button>
```

### Input

```json
{
  "usingComponents": {
    "t-input": "tdesign-miniprogram/input/input"
  }
}
```

```html
<t-input
  label="Label"
  placeholder="Please enter"
  value="{{value}}"
  bind:change="onChange"
/>
```

### Dialog

```json
{
  "usingComponents": {
    "t-dialog": "tdesign-miniprogram/dialog/dialog"
  }
}
```

```html
<t-dialog
  visible="{{visible}}"
  title="Dialog Title"
  content="Dialog content"
  confirm-btn="Confirm"
  cancel-btn="Cancel"
  bind:confirm="onConfirm"
  bind:cancel="onCancel"
/>
```

### Toast

```javascript
import Toast from 'tdesign-miniprogram/toast/index';

Toast({
  context: this,
  selector: '#t-toast',
  message: 'Toast message',
});
```

### AI Chat Interface

```json
{
  "usingComponents": {
    "t-chat-list": "tdesign-miniprogram/chat-list/chat-list",
    "t-chat-message": "tdesign-miniprogram/chat-message/chat-message",
    "t-chat-sender": "tdesign-miniprogram/chat-sender/chat-sender"
  }
}
```

```html
<t-chat-list layout="single">
  <t-chat-message
    avatar="{{item.avatar}}"
    name="{{item.name}}"
    content="{{item.content}}"
    role="{{item.role}}"
  />
  <view slot="footer">
    <t-chat-sender bind:send="onSend" />
  </view>
</t-chat-list>
```

```javascript
Component({
  data: {
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', data: 'Hello' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', data: 'Hello! How can I help you?' }],
      },
    ],
  },
  methods: {
    onSend(e) {
      const { value } = e.detail;
      // Handle send message
    },
  },
});
```

## Style Customization

### Method 1: Using Style Attribute

```html
<t-button style="color: red">Custom Style</t-button>
<t-button custom-style="color: red">Custom Style</t-button>
```

### Method 2: Disable Style Isolation

Override styles directly in page:

```css
.t-button--primary {
  background-color: navy;
}
```

In custom components, enable `styleIsolation`:

```javascript
Component({
  options: {
    styleIsolation: 'shared',
  },
});
```

### Method 3: External Style Classes

```html
<t-button t-class="my-button-class">Button</t-button>
```

```css
.my-button-class {
  background-color: navy !important;
}
```

### Method 4: CSS Variables

TDesign provides rich CSS variables for theme customization:

```css
page {
  --td-button-primary-bg-color: #0052d9;
  --td-button-border-radius: 8rpx;
}
```

## Dark Mode

### 1. Modify app.json

```json
{
  "darkmode": true
}
```

### 2. Import Design Token

In `app.wxss`:

```css
@import 'miniprogram_npm/tdesign-miniprogram/common/style/theme/_index.wxss';
```

### 3. Use CSS Variables

```css
.text {
  color: var(--td-text-color-secondary);
}
```

### 4. Special Component Adaptation

For components wrapped in `custom-tab-bar` or `root-portal`, add `.page` class:

```html
<view class="page">
  <t-tab-bar />
</view>
```

## Reference Files

This skill includes comprehensive documentation in `references/`:

### Basic Documentation

- **miniprogram/getting-started.md** - Quick start guide
- **miniprogram/overview.md** - Component overview
- **miniprogram/custom-style.md** - Style customization
- **miniprogram/custom-theme.md** - Theme customization
- **miniprogram/dark-mode.md** - Dark mode

### Component Documentation (miniprogram/components/)

- **button.md** - Button
- **input.md** - Input
- **dialog.md** - Dialog
- **form.md** - Form
- ... more component docs

### AI Chat Component Documentation (miniprogram-chat/)

- **getting-started.md** - Chat component quick start
- **sse.md** - SSE streaming
- **components/chat-message.md** - Chat message
- **components/chat-sender.md** - Chat sender
- **components/chat-list.md** - Chat list
- ... more chat component docs

Use `Read` tool to access specific reference files when detailed API information is needed.

## Key Requirements

- Minimum base library version: `^2.12.0`
- Build npm in WeChat DevTools required
- Remove `"style": "v2"` from `app.json`

## Resources

- [TDesign Official Documentation](https://tdesign.tencent.com/miniprogram/overview)
- [GitHub Repository](https://github.com/Tencent/tdesign-miniprogram)
- [Component Demo Mini Program](https://developers.weixin.qq.com/s/NSVqRNmh8l5a)

## Notes

- This skill was automatically generated from TDesign official documentation
- Reference files preserve the structure and examples from source docs
- Some reference content remains in Chinese as per official documentation
