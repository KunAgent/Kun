# Steps 步骤条

## 示例

## 引入

全局引入，在 miniprogram 根目录下的`app.json`中配置，局部引入，在需要引入的页面或组件的`index.json`中配置。

```json
"usingComponents": {
"t-steps": "tdesign-miniprogram/steps/steps",
"t-step-item": "tdesign-miniprogram/step-item/step-item",
}
```

## 代码演示

步骤条，方向可以横向和纵向，可以自定义步骤条显示内容以及是否可写

[在开发者工具中预览效果](https://developers.weixin.qq.com/s/hDDtINmI8M5F)

> Tips: 请确保开发者工具为打开状态。导入开发者工具后，依次执行：npm i > 构建npm包 > 勾选 "将JS编译成ES5"

### 组件类型

#### 水平步骤条

支持三种类型：序号、图标、简略

**WXML** (`html`):
```html
<view class="demo-desc">水平带序号步骤条</view>
<wxs module="_">
module.exports.getText = function(value, curr) { if (value > curr) return '已完成'; if (value == curr)
return'当前步骤'; return '未完成'; }
</wxs>

<view class="block">
<t-steps current="{{first}}" bind:change="onFirstChange">
<t-step-item wx:for="{{4}}" wx:key="index" title="{{_.getText(first, index)}}" content="辅助信息" />
</t-steps>
</view>

<view class="demo-desc">水平带图标步骤条</view>

<view class="block">
<t-steps current="{{second}}" bind:change="onSecondChange">
<t-step-item wx:for="{{4}}" wx:key="index" title="{{_.getText(second, index)}}" content="辅助信息" icon="cart" />
</t-steps>
</view>

<view class="demo-desc">水平简略步骤条</view>

<view class="block">
<t-steps theme="dot" current="{{third}}" bind:change="onThirdChange">
<t-step-item wx:for="{{4}}" wx:key="index" title="{{_.getText(third, index)}}" content="辅助信息" />
</t-steps>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
first: 1,
second: 1,
third: 1,
},

methods: {
onFirstChange(e) {
this.setData({ first: e.detail.current });
},
onSecondChange(e) {
this.setData({ second: e.detail.current });
},
onThirdChange(e) {
this.setData({ third: e.detail.current });
},
},
});

```

**CSS** (`css`):
```css
.block {
background-color: var(--bg-color-demo);
padding: 32rpx 0;
margin: 32rpx 0 48rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-steps": "tdesign-miniprogram/steps/steps",
"t-step-item": "tdesign-miniprogram/step-item/step-item"
}
}

```

#### 垂直步骤条

支持三种类型：序号、图标、简略

**WXML** (`html`):
```html
<wxs module="_">
module.exports.getText = function(value, curr) { if (value > curr) return '已完成步骤'; if (value == curr)
return'当前步骤'; return '未完成步骤'; }
</wxs>

<view class="demo-desc">垂直带序号步骤条</view>

<view class="block">
<t-steps layout="vertical" current="{{first}}" bind:change="onFirstChange">
<t-step-item wx:for="{{4}}" wx:key="index" title="{{_.getText(first, index)}}" content="可自定义此处内容" />
</t-steps>
</view>

<view class="demo-desc">垂直带图标步骤条</view>

<view class="block">
<t-steps layout="vertical" current="{{second}}" bind:change="onSecondChange">
<t-step-item
wx:for="{{4}}"
wx:key="index"
title="{{_.getText(second, index)}}"
content="可自定义此处内容"
icon="cart"
/>
</t-steps>
</view>

<view class="demo-desc">垂直简略步骤条</view>

<view class="block">
<t-steps layout="vertical" theme="dot" current="{{third}}" bind:change="onThirdChange">
<t-step-item wx:for="{{4}}" wx:key="index" title="{{_.getText(third, index)}}" content="可自定义此处内容" />
</t-steps>
</view>

<view class="demo-desc">垂直带自定义内容步骤条</view>

<view class="block">
<t-steps layout="vertical" current="{{third}}" bind:change="onThirdChange">
<t-step-item wx:for="{{3}}" wx:key="index" title="{{_.getText(third, index)}}" content="可自定义此处内容">
<view wx:if="{{index == 1}}" slot="extra">
<image src="https://tdesign.gtimg.com/mobile/demos/steps1.png" alt="图标" style="width: 100%" mode="widthFix" />
</view>
</t-step-item>
</t-steps>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
first: 1,
second: 1,
third: 1,
},

methods: {
onFirstChange(e) {
this.setData({ first: e.detail.current });
},
onSecondChange(e) {
this.setData({ second: e.detail.current });
},
onThirdChange(e) {
this.setData({ third: e.detail.current });
},
},
});

```

**CSS** (`css`):
```css
.block {
background-color: var(--bg-color-demo);
padding: 32rpx;
margin: 32rpx 0 48rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-steps": "tdesign-miniprogram/steps/steps",
"t-step-item": "tdesign-miniprogram/step-item/step-item"
}
}

```

### 组件状态

#### 选项卡状态

共支持 4 种状态：未完成（default）、已完成（finish）、进行中（process）、错误（error）

**WXML** (`html`):
```html
<wxs module="_">
module.exports.getText = function(value, curr) { if (value > curr) return '已完成'; if (value == curr)
return'错误步骤'; return '未完成'; }
</wxs>

<view class="block">
<t-steps current="{{first}}" bind:change="onFirstChange" current-status="error">
<t-step-item wx:for="{{4}}" wx:key="index" title="{{_.getText(first, index)}}" content="辅助信息" />
</t-steps>
</view>

<view class="block">
<t-steps current="{{second}}" bind:change="onSecondChange" current-status="error">
<t-step-item wx:for="{{4}}" wx:key="index" title="{{_.getText(second, index)}}" content="辅助信息" icon="cart" />
</t-steps>
</view>

<view class="block">
<t-steps theme="dot" current="{{third}}" bind:change="onThirdChange" current-status="error">
<t-step-item wx:for="{{4}}" wx:key="index" title="{{_.getText(third, index)}}" content="辅助信息" />
</t-steps>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
first: 1,
second: 1,
third: 1,
},

methods: {
onFirstChange(e) {
this.setData({ first: e.detail.current });
},
onSecondChange(e) {
this.setData({ second: e.detail.current });
},
onThirdChange(e) {
this.setData({ third: e.detail.current });
},
},
});

```

**CSS** (`css`):
```css
.block {
background-color: var(--bg-color-demo);
padding: 32rpx 0;
margin: 32rpx 0 48rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-steps": "tdesign-miniprogram/steps/steps",
"t-step-item": "tdesign-miniprogram/step-item/step-item"
}
}

```

### 特殊类型

通过已有特性，改造出两种常见类型：

- 垂直自定义（在 Cascader 中使用）
- 纯展示步骤条

可以参考以下代码实现

**WXML** (`html`):
```html
<wxs module="_">
module.exports.getText = function(value, curr) { if (value > curr) return '已完成步骤'; if (value == curr)
return'当前步骤'; return '未完成步骤'; }
</wxs>

<view class="demo-desc">垂直自定义步骤条</view>

<view class="block">
<t-steps layout="vertical" theme="dot" current="{{count - 1}}" bind:change="onCascader">
<t-step-item wx:for="{{count}}" wx:key="index" title="{{_.getText(count - 1, index)}}">
<t-icon name="chevron-right" size="44rpx" color="rgba(0, 0, 0, .4)" slot="title-right" />
</t-step-item>
</t-steps>

<t-button style="margin-top: 32rpx; display: block" block bind:tap="toNext">下一步</t-button>
</view>

<view class="demo-desc">纯展示步骤条</view>

<view class="block">
<t-steps layout="vertical" readonly theme="dot" current="{{5}}">
<t-step-item wx:for="{{4}}" wx:key="index" title="步骤展示" content="可自定义此处内容" />
</t-steps>
</view>

```

**JS** (`javascript`):
```javascript
Component({
data: {
count: 4,
},
methods: {
toNext() {
this.setData({ count: this.data.count + 1 });
},
onCascader(e) {
const { current } = e.detail;

this.setData({
count: current + 1,
});
},
},
});

```

**CSS** (`css`):
```css
.block {
background-color: var(--bg-color-demo);
padding: 32rpx;
margin: 32rpx 0 48rpx;
}

```

**JSON** (`javascript`):
```javascript
{
"component": true,
"styleIsolation": "apply-shared",
"usingComponents": {
"t-steps": "tdesign-miniprogram/steps/steps",
"t-step-item": "tdesign-miniprogram/step-item/step-item",
"t-icon": "tdesign-miniprogram/icon/icon"
}
}

```

## API

### StepsProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| current | String / Number | - | 当前步骤，即整个步骤条进度。默认根据步骤下标判断步骤的完成状态，当前步骤为进行中，当前步骤之前的步骤为已完成，当前步骤之后的步骤为未开始。如果每个步骤没有设置 value，current 值为步骤长度则表示所有步骤已完成。如果每个步骤设置了自定义 value，则 current = 'FINISH' 表示所有状态完成 | N |
| default-current | String / Number | undefined | 当前步骤，即整个步骤条进度。默认根据步骤下标判断步骤的完成状态，当前步骤为进行中，当前步骤之前的步骤为已完成，当前步骤之后的步骤为未开始。如果每个步骤没有设置 value，current 值为步骤长度则表示所有步骤已完成。如果每个步骤设置了自定义 value，则 current = 'FINISH' 表示所有状态完成。非受控属性 | N |
| current-status | String | process | 用于控制 current 指向的步骤条的状态。可选项：default/process/finish/error | N |
| layout | String | horizontal | 步骤条方向，有两种：横向和纵向。可选项：horizontal/vertical | N |
| readonly | Boolean | undefined | 只读状态 | N |
| sequence | String | positive | 步骤条顺序。可选项：positive/reverse | N |
| theme | String | default | 步骤条风格。可选项：default/dot | N |

### StepsEvents

| 名称 | 参数 | 描述 |
| --- | --- | --- |
| change | `({current: string \| number, previous: string \| number})` | 当前步骤发生变化时触发 |

### StepsSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义步骤条内容 |

### StepsExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |

### StepItemProps

| 名称 | 类型 | 默认值 | 描述 | 必传 |
| --- | --- | --- | --- | --- |
| style | Object | - | 样式 | N |
| custom-style | Object | - | 样式，一般用于开启虚拟化组件节点场景 | N |
| content | String | '' | 步骤描述 | N |
| extra | String | - | 步骤条自定义内容 | N |
| icon | String | - | 图标。传入 slot 代表使用插槽，其他字符串代表使用内置图标 | N |
| status | String | default | 当前步骤的状态：默认状态（未开始）、进行中状态、完成状态、错误状态。可选项：default/process/finish/error。TS 类型：`StepStatus``type StepStatus = 'default' \| 'process' \| 'finish' \| 'error'`。详细类型定义 | N |
| sub-step-items | Array | [] | 已废弃。子步骤条，仅支持 layout  = 'vertical' 时。TS 类型：`SubStepItem[]``interface SubStepItem { status: StepStatus, title: string }`。详细类型定义 | N |
| title | String | '' | 标题 | N |

### StepItemSlots

| 名称 | 描述 |
| --- | --- |
| - | 默认插槽，自定义步骤内容 |
| content | 自定义`content`显示内容 |
| extra | 自定义`extra`显示内容 |
| icon | 自定义`icon`显示内容 |
| title | 自定义`title`显示内容 |

### StepItemExternalClasses

| 类名 | 描述 |
| --- | --- |
| t-class | 根节点样式类 |
| t-class-content | 内容样式类 |
| t-class-description | 描述样式类 |
| t-class-extra | 额外样式类 |
| t-class-title | 标题样式类 |

### CSSVariables

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --td-step-item-circle-size | 44rpx | - |
| --td-step-item-circle-text-font | @font-body-medium | - |
| --td-step-item-default-circle-bg | @bg-color-secondarycontainer | - |
| --td-step-item-default-circle-color | @text-color-placeholder | - |
| --td-step-item-default-dot-border-color | @component-border | - |
| --td-step-item-default-icon-color | @text-color-placeholder | - |
| --td-step-item-default-title-color | @text-color-placeholder | - |
| --td-step-item-description-color | @text-color-placeholder | - |
| --td-step-item-dot-size | 16rpx | - |
| --td-step-item-error-circle-bg | @error-color-1 | - |
| --td-step-item-error-circle-color | @error-color | - |
| --td-step-item-error-dot-border-color | @error-color | - |
| --td-step-item-error-icon-color | @error-color | - |
| --td-step-item-error-title-color | @error-color | - |
| --td-step-item-finish-circle-bg | @brand-color-light | - |
| --td-step-item-finish-circle-color | @brand-color | - |
| --td-step-item-finish-dot-border-color | @brand-color | - |
| --td-step-item-finish-icon-color | @brand-color | - |
| --td-step-item-finish-line-color | @brand-color | - |
| --td-step-item-finish-title-color | @text-color-primary | - |
| --td-step-item-line-color | @component-border | - |
| --td-step-item-process-circle-bg | @brand-color | - |
| --td-step-item-process-circle-color | @text-color-anti | - |
| --td-step-item-process-dot-border-color | @brand-color | - |
| --td-step-item-process-icon-color | @brand-color | - |
| --td-step-item-process-title-color | @brand-color | - |