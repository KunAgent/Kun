# Cell 单元格

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-cell-group": "tdesign-miniprogram/cell-group/cell-group"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/M8XBNNmG855M)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 类型

单行单元格

**WXML** (`html`):
```html
<t-cell title="单行标题" hover arrow />
<t-cell title="单行标题" hover required arrow />
<t-cell title="单行标题" hover arrow ariaLabel="单行标题，有16条消息">
<t-badge count="{{16}}" slot="note" />
</t-cell>
<t-cell title="单行标题" hover>
<t-switch defaultValue="{{true}}" slot="note" />
</t-cell>
<t-cell title="单行标题" hover note="辅助信息" arrow />
<t-cell title="单行标题" hover arrow leftIcon="app" bordered="{{false}}" />

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-badge": "tdesign-miniprogram/badge/badge",
"t-switch": "tdesign-miniprogram/switch/switch",
"t-icon": "tdesign-miniprogram/icon/icon"
}
}

```

多行单元格

**WXML** (`html`):
```html
<t-cell title="单行标题" description="一段很长很长的内容文字" hover arrow />
<t-cell title="单行标题" description="一段很长很长的内容文字" hover arrow required />
<t-cell title="单行标题" description="一段很长很长的内容文字" hover arrow>
<t-badge count="{{16}}" slot="note" />
</t-cell>
<t-cell title="单行标题" description="一段很长很长的内容文字" hover>
<t-switch defaultValue="{{true}}" slot="note" />
</t-cell>
<t-cell title="单行标题" description="一段很长很长的内容文字" note="辅助信息" hover arrow />
<t-cell title="单行标题" description="一段很长很长的内容文字" leftIcon="app" hover arrow />
<t-cell title="单行标题" description="一段很长很长的内容文字，长文本自动换行，该选项的描述是一段很长的内容" hover />
<t-cell title="单行标题" description="一段很长很长很长的内容文字" hover arrow>
<view class="avatar" slot="left-icon">
<open-data type="userAvatarUrl" />
</view>
</t-cell>
<t-cell
title="单行标题"
description="一段很长很长的内容文字"
align="top"
image="https://tdesign.gtimg.com/mobile/demos/avatar1.png"
hover
bordered="{{false}}"
/>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.avatar {
width: 96rpx;
height: 96rpx;
border-radius: 50%;
overflow: hidden;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-icon": "tdesign-miniprogram/icon/icon",
"t-switch": "tdesign-miniprogram/switch/switch"
}
}

```

### 样式

卡片单元格

**WXML** (`html`):
```html
<t-cell-group theme="card">
<t-cell title="单行标题" leftIcon="service" hover arrow />
<t-cell title="单行标题" leftIcon="internet" hover arrow />
<t-cell title="单行标题" leftIcon="lock-on" hover arrow />
</t-cell-group>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-cell-group": "tdesign-miniprogram/cell-group/cell-group",
"t-cell": "tdesign-miniprogram/cell/cell",
"t-icon": "tdesign-miniprogram/icon/icon"
}
}

```

## API

### CellProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| align | String | middle | 右侧内容的对齐方式，默认居中对齐。可选项：top/middle/bottom | N |
| arrow | Boolean / Object | false | 是否显示右侧箭头 | N |
| bordered | Boolean | true | 是否显示下边框 | N |
| description | String | - | 下方内容描述 | N |
| hover | Boolean | - | 是否开启点击反馈 | N |
| image | String | - | 主图 | N |
| jump-type | String | navigateTo | 链接跳转类型。可选项：switchTab/reLaunch/redirectTo/navigateTo | N |
| left-icon | String / Object | - | 左侧图标，出现在单元格标题的左侧 | N |
| note | String | - | 和标题同行的说明文字 | N |
| required | Boolean | false | 是否显示表单必填星号 | N |
| right-icon | String / Object | - | 最右侧图标 | N |
| title | String | - | 标题 | N |
| url | String | - | 点击后跳转链接地址。如果值为空，则表示不需要跳转 | N |

### CellEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| click | - | 右侧内容 |

### CellSlots

| 名称 | 描述 |
| --- | --- |
| description | 自定义`description`显示内容 |
| image | 自定义`image`显示内容 |
| left-icon | 自定义`left-icon`显示内容 |
| note | 自定义`note`显示内容 |
| right-icon | 自定义`right-icon`显示内容 |
| title | 自定义`title`显示内容 |

### CellExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-center | 中间（`title`,`description`）内容样式类 |
| t-class-description | 下方描述内容样式类 |
| t-class-hover | 悬停样式类 |
| t-class-image | 图片样式类 |
| t-class-left | 左侧内容样式类 |
| t-class-left-icon | 左侧图标样式类 |
| t-class-note | 右侧说明文字样式类 |
| t-class-right | 右侧内容样式类 |
| t-class-right-icon | 右侧图标样式类 |
| t-class-title | 标题样式类 |

### CellGroupProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| bordered | Boolean | false | 是否显示组边框 | N |
| theme | String | default | 单元格组风格。可选项：default/card | N |
| title | String | - | 单元格组标题 | N |

### CellGroupSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容区域内容 |

### CellGroupExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-title | 标题样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-cell-group-border-color | @component-stroke | - |
| --td-cell-group-title-bg-color | @bg-color-secondarycontainer | - |
| --td-cell-group-title-color | @text-color-placeholder | - |
| --td-cell-group-title-font-size | 28rpx | - |
| --td-cell-group-title-line-height | 90rpx | - |
| --td-cell-group-title-padding-left | 32rpx | - |
| --td-cell-bg-color | @bg-color-container | - |
| --td-cell-border-color | @component-stroke | - |
| --td-cell-border-left-space | @cell-horizontal-padding | - |
| --td-cell-border-right-space | 0 | - |
| --td-cell-border-width | 1px | - |
| --td-cell-description-color | @text-color-secondary | - |
| --td-cell-description-font | @font-body-medium | - |
| --td-cell-height | auto | - |
| --td-cell-horizontal-padding | 32rpx | - |
| --td-cell-hover-color | @bg-color-secondarycontainer | - |
| --td-cell-image-height | 96rpx | - |
| --td-cell-image-width | 96rpx | - |
| --td-cell-left-icon-color | @brand-color | - |
| --td-cell-left-icon-size | 48rpx | - |
| --td-cell-note-color | @text-color-placeholder | - |
| --td-cell-note-font-size | @font-size-m | - |
| --td-cell-required-color | @error-color | - |
| --td-cell-required-font-size | @font-size-m | - |
| --td-cell-right-icon-color | @text-color-placeholder | - |
| --td-cell-right-icon-size | 48rpx | - |
| --td-cell-title-color | @text-color-primary | - |
| --td-cell-title-font | @font-body-large | - |
| --td-cell-vertical-padding | 32rpx | - |