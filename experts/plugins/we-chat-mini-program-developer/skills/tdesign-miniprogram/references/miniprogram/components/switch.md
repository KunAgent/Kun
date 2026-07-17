# Switch 开关

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-switch": "tdesign-miniprogram/switch/switch"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/IsE5yNmz865p)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 基础开关

**WXML** (`html`):
```html
<t-cell title="基础开关" bordered="{{false}}">
<t-switch defaultValue="{{true}}" slot="note" />
</t-cell>

```

**JS** (`javascript`):
```javascript
Component({
data: {
defaultVal: true,
},
methods: {
handleChange(e) {
this.setData({
defaultVal: e.detail.value,
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
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-switch": "tdesign-miniprogram/switch/switch"
}
}

```

### 带描述开关

**WXML** (`html`):
```html
<t-cell title="带文字开关">
<t-switch bindchange="handleChange" value="{{defaultVal}}" label="{{['开', '关']}}" slot="note" />
</t-cell>

<t-cell title="带图标开关" bordered="{{false}}">
<t-switch defaultValue="{{true}}" icon="{{['check', 'close']}}" slot="note" />
</t-cell>

```

**JS** (`javascript`):
```javascript
Component({
data: {
defaultVal: true,
},
methods: {
handleChange(e) {
this.setData({
defaultVal: e.detail.value,
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
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-switch": "tdesign-miniprogram/switch/switch"
}
}

```

### 自定义颜色

**WXML** (`html`):
```html
<view class="custom-color">
<t-cell title="自定义颜色开关" bordered="{{false}}">
<t-switch defaultValue="{{true}}" slot="note" />
</t-cell>
<!-- <t-cell title="自定义颜色" bordered="{{false}}">
<t-switch loading defaultValue="{{true}}" slot="note" />
</t-cell>
<t-cell title="自定义颜色" bordered="{{false}}">
<t-switch defaultValue="{{true}}" label="{{['关', '开']}}" slot="note" />
</t-cell>
<t-cell title="自定义颜色" bordered="{{false}}">
<t-switch defaultValue="{{true}}" icon="{{['close', 'check']}}" slot="note" />
</t-cell> -->
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
defaultVal: true,
},
methods: {
handleChange(e) {
this.setData({
defaultVal: e.detail.value,
});
},
},
});

```

**CSS** (`css`):
```css
.custom-color {
--td-switch-checked-color: #00a870;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-switch": "tdesign-miniprogram/switch/switch"
}
}

```

### 开关状态

**WXML** (`html`):
```html
<view class="demo-desc">加载状态</view>

<view class="group">
<t-cell title="加载状态">
<t-switch defaultValue="{{false}}" loading slot="note" />
</t-cell>
<t-cell title="加载状态" bordered="{{false}}">
<t-switch defaultValue="{{true}}" loading slot="note" />
</t-cell>
</view>

<view class="demo-desc">禁用状态</view>

<view class="group">
<t-cell title="禁用状态">
<t-switch disabled slot="note" />
</t-cell>
<t-cell title="禁用状态" bordered="{{false}}">
<t-switch default-value="{{true}}" disabled slot="note" />
</t-cell>
</view>

```

**JS** (`javascript`):
```javascript
Component({});

```

**CSS** (`css`):
```css
.group {
margin-top: 32rpx;
}

.group + .demo-desc {
margin-top: 48rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-switch": "tdesign-miniprogram/switch/switch"
}
}

```

### 尺寸

**WXML** (`html`):
```html
<t-cell title="大尺寸 32">
<t-switch defaultValue="{{true}}" size="large" slot="note" />
</t-cell>
<t-cell title="中尺寸 28">
<t-switch defaultValue="{{true}}" slot="note" />
</t-cell>
<t-cell title="小尺寸 24" bordered="{{false}}">
<t-switch defaultValue="{{true}}" size="small" slot="note" />
</t-cell>

```

**JS** (`javascript`):
```javascript
Component({
data: {
defaultVal: true,
},
methods: {
handleChange(e) {
this.setData({
defaultVal: e.detail.value,
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
"usingComponents": {
"t-cell": "tdesign-miniprogram/cell/cell",
"t-switch": "tdesign-miniprogram/switch/switch"
}
}

```

## API

### SwitchProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| custom-value | Array | [true, false] | 用于自定义开关的值，[打开时的值，关闭时的值]。默认为 [true, false]。示例：[1, 0]、['open', 'close']。TS 类型：`Array<SwitchValue>` | N |
| disabled | Boolean | undefined | 是否禁用组件。优先级：Switch.disabled > Form.disabled | N |
| icon | Array | [] | `0.27.0`。开关的图标；[打开时的图标，关闭时的图标]。TS 类型：`string[]` | N |
| label | Array | [] | `0.27.0`。开关内容，[开启时内容，关闭时内容]。示例：['开', '关'] 。TS 类型：`string[]` | N |
| loading | Boolean | false | `0.27.0`。是否处于加载中状态 | N |
| size | String | medium | `0.27.0`。开关尺寸。可选项：small/medium/large | N |
| value | String / Number / Boolean | null | 开关值。TS 类型：`SwitchValue``type SwitchValue = string \| number \| boolean`。详细类型定义 | N |
| default-value | String / Number / Boolean | undefined | 开关值。非受控属性。TS 类型：`SwitchValue``type SwitchValue = string \| number \| boolean`。详细类型定义 | N |

### SwitchEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(value: SwitchValue)` | 数据发生变化时触发 |

### SwitchExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-body | 描述文本样式类 |
| t-class-dot | 滑块样式类 |
| t-class-label | 开关内容样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-switch-checked-color | @brand-color | - |
| --td-switch-checked-disabled-color | @brand-color-disabled | - |
| --td-switch-dot-disabled-color | @font-white-1 | - |
| --td-switch-dot-horizontal-margin | 6rpx | - |
| --td-switch-dot-large-size | 52rpx | - |
| --td-switch-dot-plain-horizontal-margin | 10rpx | - |
| --td-switch-dot-plain-large-size | 44rpx | - |
| --td-switch-dot-plain-size | 36rpx | - |
| --td-switch-dot-plain-small-size | 28rpx | - |
| --td-switch-dot-shadow | @shadow-1 | - |
| --td-switch-dot-size | 44rpx | - |
| --td-switch-dot-small-size | 36rpx | - |
| --td-switch-height | 56rpx | - |
| --td-switch-icon-large-size | 48rpx | - |
| --td-switch-icon-size | 40rpx | - |
| --td-switch-icon-small-size | 32rpx | - |
| --td-switch-label-checked-color | @switch-checked-color | - |
| --td-switch-label-color | @bg-color-secondarycontainer-active | - |
| --td-switch-label-font-size | 28rpx | - |
| --td-switch-label-large-font-size | 32rpx | - |
| --td-switch-label-small-font-size | 24rpx | - |
| --td-switch-large-height | 64rpx | - |
| --td-switch-large-radius | calc(@switch-large-height / 2) | - |
| --td-switch-large-width | 104rpx | - |
| --td-switch-loading-color | @brand-color | - |
| --td-switch-radius | calc(@switch-height / 2) | - |
| --td-switch-small-height | 48rpx | - |
| --td-switch-small-radius | calc(@switch-small-height / 2) | - |
| --td-switch-small-width | 78rpx | - |
| --td-switch-unchecked-color | @bg-color-secondarycontainer-active | - |
| --td-switch-unchecked-disabled-color | @bg-color-component-disabled | - |
| --td-switch-width | 90rpx | - |