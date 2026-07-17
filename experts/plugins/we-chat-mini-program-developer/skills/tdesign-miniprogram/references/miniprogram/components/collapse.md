# Collapse 折叠面板

## 示例

该组件于 0.7.3 版本上线，请留意版本。
## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-collapse": "tdesign-miniprogram/collapse/collapse",
"t-collapse-panel": "tdesign-miniprogram/collapse-panel/collapse-panel"
}
```

## 代码演示

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/d6Xg3Nmp8W5B)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 类型

基础折叠面板

**WXML** (`html`):
```html
<view class="wrapper">
<t-collapse value="{{activeValues}}" bind:change="handleChange">
<t-collapse-panel header="折叠面板标题" value="{{0}}" expandIcon>
此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容
</t-collapse-panel>
</t-collapse>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
activeValues: [0],
},
methods: {
handleChange(e) {
this.setData({
activeValues: e.detail.value,
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
"t-collapse": "tdesign-miniprogram/collapse/collapse",
"t-collapse-panel": "tdesign-miniprogram/collapse-panel/collapse-panel"
}
}

```

带操作说明

**WXML** (`html`):
```html
<wxs module="_"> module.exports.contains = function(arr, target) { return arr.indexOf(target) > -1; } </wxs>
<view class="wrapper">
<t-collapse value="{{activeValues}}" bind:change="handleChange">
<t-collapse-panel
header="折叠面板标题"
header-right-content="{{_.contains(activeValues, 0) ? '收起' : '展开'}}"
value="{{0}}"
expandIcon
>
此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容
</t-collapse-panel>
</t-collapse>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
activeValues: [0],
},
methods: {
handleChange(e) {
this.setData({
activeValues: e.detail.value,
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
"t-collapse": "tdesign-miniprogram/collapse/collapse",
"t-collapse-panel": "tdesign-miniprogram/collapse-panel/collapse-panel"
}
}

```

手风琴模式

**WXML** (`html`):
```html
<t-collapse defaultValue="{{[0]}}" expandMutex expandIcon>
<t-collapse-panel header="折叠面板标题" value="{{0}}">
此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容
</t-collapse-panel>
<t-collapse-panel header="折叠面板标题" value="{{1}}">
此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容
</t-collapse-panel>
<t-collapse-panel header="折叠面板标题" value="{{2}}">
此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容
</t-collapse-panel>
<t-collapse-panel header="折叠面板标题" disabled value="{{3}}">
此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容
</t-collapse-panel>
</t-collapse>

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
"t-collapse": "tdesign-miniprogram/collapse/collapse",
"t-collapse-panel": "tdesign-miniprogram/collapse-panel/collapse-panel"
}
}

```

### 样式

卡片折叠面板

**WXML** (`html`):
```html
<t-collapse theme="card" defaultValue="{{[3]}}" expandIcon>
<t-collapse-panel header="折叠面板标题" value="{{0}}">
此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容
</t-collapse-panel>
<t-collapse-panel header="折叠面板标题" value="{{1}}">
此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容
</t-collapse-panel>
<t-collapse-panel header="折叠面板标题" value="{{2}}">
此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容
</t-collapse-panel>
<t-collapse-panel header="折叠面板标题" disabled value="{{3}}">
此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容此处可自定义内容
</t-collapse-panel>
</t-collapse>

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
"t-collapse": "tdesign-miniprogram/collapse/collapse",
"t-collapse-panel": "tdesign-miniprogram/collapse-panel/collapse-panel"
}
}

```

## API

### CollapseProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| default-expand-all | Boolean | false | 默认是否展开全部 | N |
| disabled | Boolean | - | 是否禁用面板展开/收起操作 | N |
| expand-icon | Boolean | true | 展开图标 | N |
| expand-mutex | Boolean | false | 每个面板互斥展开，每次只展开一个面板 | N |
| theme | String | default | 折叠面板风格。可选项：default/card | N |
| value | Array | [] | 展开的面板集合。TS 类型：`CollapseValue``type CollapseValue = Array<string \| number>`。详细类型定义 | N |
| default-value | Array | undefined | 展开的面板集合。非受控属性。TS 类型：`CollapseValue``type CollapseValue = Array<string \| number>`。详细类型定义 | N |

### CollapseEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `(value: CollapseValue)` | 切换面板时触发，返回变化的值 |

### CollapseSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义内容区域内容 |

### CollapsePanelProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| content | String | - | 折叠面板内容 | N |
| disabled | Boolean | undefined | 禁止当前面板展开，优先级大于 Collapse 的同名属性 | N |
| expand-icon | Boolean | undefined | 当前折叠面板展开图标，优先级大于 Collapse 的同名属性 | N |
| header | String | - | 面板头内容 | N |
| header-left-icon | String | - | 面板头左侧图标 | N |
| header-right-content | String | - | 面板头的右侧区域，一般用于呈现面板操作 | N |
| placement | String | bottom | `0.34.0`。选项卡内容的位置。可选项：bottom/top | N |
| value | String / Number | - | 当前面板唯一标识，如果值为空则取当前面下标兜底作为唯一标识 | N |

### CollapsePanelSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，作用同`content`插槽 |
| content | 自定义`content`显示内容 |
| expand-icon | 自定义`expand-icon`显示内容 |
| header | 自定义`header`显示内容 |
| header-left-icon | 自定义`header-left-icon`显示内容 |
| header-right-content | 自定义`header-right-content`显示内容 |

### CollapsePanelExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-content | 内容样式类 |
| t-class-header | 头部样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-collapse-border-color | @border-level-1-color | - |
| --td-collapse-content-font | @font-body-medium | - |
| --td-collapse-content-padding | 32rpx | - |
| --td-collapse-content-text-color | @text-color-primary | - |
| --td-collapse-extra-font | @font-body-large | - |
| --td-collapse-header-height | auto | - |
| --td-collapse-header-text-color | @text-color-primary | - |
| --td-collapse-header-text-disabled-color | @text-color-disabled | - |
| --td-collapse-horizontal-padding | 32rpx | - |
| --td-collapse-icon-color | @font-gray-3 | - |
| --td-collapse-panel-bg-color | @bg-color-container | - |
| --td-collapse-title-font | @font-body-large | - |