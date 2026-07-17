# TabBar 底部标签栏

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-tab-bar": "tdesign-miniprogram/tab-bar/tab-bar",
"t-tab-bar-item": "tdesign-miniprogram/tab-bar-item/tab-bar-item"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/MCE5rNmh8953)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

#### 纯文本标签栏

**WXML** (`html`):
```html
<t-tab-bar t-class="t-tab-bar" value="{{value}}" theme="tag" fixed="{{false}}" split="{{false}}" bindchange="onChange">
<t-tab-bar-item wx:for="{{list}}" wx:key="index" value="{{item.value}}"> {{item.label}} </t-tab-bar-item>
</t-tab-bar>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: 'home',
list: [
{ value: 'home', label: '首页' },
{ value: 'app', label: '应用' },
{ value: 'chat', label: '聊天' },
{ value: 'user', label: '我的' },
],
},

methods: {
onChange(e) {
this.setData({
value: e.detail.value,
});
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-tab-bar": "tdesign-miniprogram/tab-bar/tab-bar",
"t-tab-bar-item": "tdesign-miniprogram/tab-bar-item/tab-bar-item"
}
}

```

#### 图标加文字标签栏

**WXML** (`html`):
```html
<t-tab-bar t-class="t-tab-bar" value="{{value}}" bindchange="onChange" theme="tag" fixed="{{false}}" split="{{false}}">
<t-tab-bar-item wx:for="{{list}}" wx:key="value" value="{{item.value}}" icon="{{item.icon}}">
{{item.label}}
</t-tab-bar-item>
</t-tab-bar>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: 'label_1',
list: [
{ value: 'label_1', label: '首页', icon: 'home' },
{ value: 'label_2', label: '应用', icon: 'app' },
{ value: 'label_3', label: '聊天', icon: 'chat' },
{ value: 'label_4', label: '我的', icon: 'user' },
],
},

methods: {
onChange(e) {
this.setData({
value: e.detail.value,
});
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-tab-bar": "tdesign-miniprogram/tab-bar/tab-bar",
"t-tab-bar-item": "tdesign-miniprogram/tab-bar-item/tab-bar-item"
}
}

```

#### 纯图标标签栏

**WXML** (`html`):
```html
<t-tab-bar t-class="t-tab-bar" value="{{value}}" theme="tag" fixed="{{false}}" split="{{false}}" bindchange="onChange">
<t-tab-bar-item
wx:for="{{list}}"
wx:key="value"
value="{{item.value}}"
icon="{{item.icon}}"
ariaLabel="{{item.ariaLabel}}"
></t-tab-bar-item>
</t-tab-bar>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: 'label_1',
list: [
{ value: 'label_1', icon: 'home', ariaLabel: '首页' },
{ value: 'label_2', icon: 'app', ariaLabel: '软件' },
{ value: 'label_3', icon: 'chat', ariaLabel: '聊天' },
{ value: 'label_4', icon: 'user', ariaLabel: '我的' },
],
},

methods: {
onChange(e) {
this.setData({
value: e.detail.value,
});
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-tab-bar": "tdesign-miniprogram/tab-bar/tab-bar",
"t-tab-bar-item": "tdesign-miniprogram/tab-bar-item/tab-bar-item"
}
}

```

#### 双层级纯文本标签栏

**WXML** (`html`):
```html
<t-tab-bar t-class="t-tab-bar" defaultValue="user" theme="tag" fixed="{{false}}" split="{{false}}">
<t-tab-bar-item wx:for="{{list}}" wx:key="value" value="{{item.value}}" sub-tab-bar="{{item.children}}">
{{item.label}}
</t-tab-bar-item>
</t-tab-bar>

```

**JS** (`javascript`):
```javascript
const list = [
{
value: 'home',
label: '首页',
icon: 'home',
children: [],
},
{
value: 'app',
label: '应用',
icon: 'app',
children: [],
},
{
value: 'user',
label: '我的',
children: [
{
value: 'info',
label: '基本信息',
},
{
value: 'home-page',
label: '个人主页',
},
{
value: 'setting',
label: '设置',
},
],
},
];

Component({
data: {
list,
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-tab-bar": "tdesign-miniprogram/tab-bar/tab-bar",
"t-tab-bar-item": "tdesign-miniprogram/tab-bar-item/tab-bar-item"
}
}

```

### 组件样式

#### 弱选中标签栏

**WXML** (`html`):
```html
<!-- 文本 + 徽标 -->
<view class="wrapper">
<t-tab-bar t-class="t-tab-bar" defaultValue="label1" fixed="{{false}}">
<t-tab-bar-item badge-props="{{ {count: 16, offset: [16, 0]} }}" ariaLabel="首页，有16条消息" value="label1">
首页
</t-tab-bar-item>
<t-tab-bar-item badge-props="{{ { dot: true, offset: [16, 0] } }}" ariaLabel="应用，有新的消息" value="label2">
应用
</t-tab-bar-item>
<t-tab-bar-item badge-props="{{ {count: 'New', offset: [16, 0]} }}" ariaLabel="聊天，New" value="label3">
聊天
</t-tab-bar-item>
<t-tab-bar-item badge-props="{{ {count: '···', offset: [16, 0]} }}" ariaLabel="我的，有很多消息" value="label4">
我的
</t-tab-bar-item>
</t-tab-bar>
</view>

<!-- 图标 + 徽标 -->
<view class="wrapper">
<t-tab-bar t-class="t-tab-bar" defaultValue="label1" fixed="{{false}}" split="{{false}}">
<t-tab-bar-item badge-props="{{ {count: 16} }}" ariaLabel="首页，有16条消息" value="label1" icon="home" />
<t-tab-bar-item badge-props="{{ { dot: true } }}" ariaLabel="应用，有新的消息" value="label2" icon="app" />
<t-tab-bar-item badge-props="{{ {count: 'New'} }}" ariaLabel="聊天，New" value="label3" icon="chat" />
<t-tab-bar-item badge-props="{{ {count: '···'} }}" ariaLabel="我的，有很多消息" value="label4" icon="user" />
</t-tab-bar>
</view>

<!-- 文本 + 图标 + 徽标 -->
<view class="wrapper">
<t-tab-bar t-class="t-tab-bar" defaultValue="label1" fixed="{{false}}" split="{{false}}">
<t-tab-bar-item badge-props="{{ {count: 16} }}" ariaLabel="首页，有16条消息" value="label1" icon="home">
首页
</t-tab-bar-item>
<t-tab-bar-item badge-props="{{ { dot: true } }}" ariaLabel="应用，有新的消息" value="label2" icon="app">
应用
</t-tab-bar-item>
<t-tab-bar-item badge-props="{{ {count: 'New'} }}" ariaLabel="聊天，New" value="label3" icon="chat">
聊天
</t-tab-bar-item>
<t-tab-bar-item badge-props="{{ {count: '···'} }}" ariaLabel="我的，有很多消息" value="label4" icon="user">
我的
</t-tab-bar-item>
</t-tab-bar>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
list: [
{ value: 'label_1', label: '文字', icon: 'home' },
{ value: 'label_2', label: '文字', icon: 'app' },
{ value: 'label_3', label: '文字', icon: 'chat' },
{ value: 'label_4', label: '文字', icon: 'user' },
],
},
});

```

**CSS** (`css`):
```css
.wrapper:not(:last-child) {
margin-bottom: 32rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-tab-bar": "tdesign-miniprogram/tab-bar/tab-bar",
"t-tab-bar-item": "tdesign-miniprogram/tab-bar-item/tab-bar-item"
}
}

```

#### 悬浮胶囊标签栏

**WXML** (`html`):
```html
<t-tab-bar
t-class="t-tab-bar"
value="{{value}}"
shape="round"
theme="tag"
fixed="{{false}}"
split="{{false}}"
bindchange="onChange"
>
<t-tab-bar-item
wx:for="{{list}}"
wx:key="value"
value="{{item.value}}"
icon="{{item.icon}}"
ariaLabel="{{item.ariaLabel}}"
>
</t-tab-bar-item>
</t-tab-bar>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: 'label_1',
list: [
{ value: 'label_1', icon: 'home', ariaLabel: '首页' },
{ value: 'label_2', icon: 'app', ariaLabel: '软件' },
{ value: 'label_3', icon: 'chat', ariaLabel: '聊天' },
{ value: 'label_4', icon: 'user', ariaLabel: '我的' },
],
},

methods: {
onChange(e) {
this.setData({
value: e.detail.value,
});
},
},
});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-tab-bar": "tdesign-miniprogram/tab-bar/tab-bar",
"t-tab-bar-item": "tdesign-miniprogram/tab-bar-item/tab-bar-item"
}
}

```

#### 自定义主题

**WXML** (`html`):
```html
<view class="wrapper">
<t-tab-bar t-class="t-tab-bar" value="{{value}}" fixed="{{false}}" bindchange="onChange">
<t-tab-bar-item
wx:for="{{list}}"
wx:key="value"
value="{{item.value}}"
icon="{{item.icon}}"
ariaLabel="{{item.ariaLabel}}"
></t-tab-bar-item>
</t-tab-bar>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
value: 'label_1',
list: [
{ value: 'label_1', icon: 'home', ariaLabel: '首页' },
{ value: 'label_2', icon: 'app', ariaLabel: '软件' },
{ value: 'label_3', icon: 'chat', ariaLabel: '聊天' },
{ value: 'label_4', icon: 'user', ariaLabel: '我的' },
],
},

methods: {
onChange(e) {
this.setData({
value: e.detail.value,
});
},
},
});

```

**CSS** (`css`):
```css
.wrapper {
--td-tab-bar-border-color: var(--td-border-level-1-color, #e7e7e7);
--td-tab-bar-bg-color: var(--td-bg-color-secondarycontainer, #f3f3f3);
--td-tab-bar-hover-color: #ddd;
--td-tab-bar-item-color: var(--td-text-color-primary, rgba(0, 0, 0, 0.9));
--td-tab-bar-item-active-color: var(--td-brand-color, #0052d9);
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-tab-bar": "tdesign-miniprogram/tab-bar/tab-bar",
"t-tab-bar-item": "tdesign-miniprogram/tab-bar-item/tab-bar-item"
}
}

```

## API

### TabBarProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| bordered | Boolean | true | 是否显示外边框 | N |
| fixed | Boolean | true | 是否固定在底部 | N |
| placeholder | Boolean | false | `1.12.1`。固定在底部时是否开启占位 | N |
| safe-area-inset-bottom | Boolean | true | 是否开启底部安全区适配 | N |
| shape | String | normal | 标签栏的形状。可选项：normal/round | N |
| split | Boolean | true | 是否需要分割线 | N |
| theme | String | normal | 选项风格。可选项：normal/tag | N |
| value | String / Number / Array | - | 当前选中标签的索引。TS 类型：`string \| number \| Array<string \| number>` | N |
| default-value | String / Number / Array | undefined | 当前选中标签的索引。非受控属性。TS 类型：`string \| number \| Array<string \| number>` | N |
| z-index | Number | 1 | 标签栏层级 | N |

### TabBarEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(value: string \| number)` | 选中标签切换时触发 |

### TabBarExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |

### TabBarItemProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| badge-props | Object | - | 图标右上角提示信息。TS 类型：`BadgeProps`，Badge API Documents。详细类型定义 | N |
| icon | String / Object | - | 图标名称。传入对象时透传至 Icon 组件 | N |
| sub-tab-bar | Array | - | 二级菜单。TS 类型：`SubTabBarItem[] ``interface SubTabBarItem { value: string; label: string }`。详细类型定义 | N |
| value | String / Number | - | 标识符 | N |

### TabBarItemSlots

| 名称 | 描述 |
| --- | --- |
| icon | 图标插槽，用于自定义图标区域内容 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-tab-bar-bg-color | @bg-color-container | - |
| --td-tab-bar-border-color | @border-level-1-color | - |
| --td-tab-bar-round-shadow | @shadow-3 | - |
| --td-tab-bar-active-bg | @brand-color-light | - |
| --td-tab-bar-active-color | @brand-color | - |
| --td-tab-bar-color | @text-color-primary | - |
| --td-tab-bar-height | 80rpx | - |
| --td-tab-bar-hover-bg-color | rgba(0, 0, 0, 0.05) | - |
| --td-tab-bar-spread-border-color | @border-color | - |
| --td-tab-bar-spread-shadow | @shadow-3 | - |