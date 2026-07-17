# input 与 textarea 组件

## 概述

Skyline 下的 `input` 和 `textarea` 组件在保持与 WebView 兼容的基础上，新增了 worklet 键盘回调、输入法组合事件等增强特性，可以实现更流畅的键盘交互体验。

## input 组件

### 基本用法

```html
<input 
  value="{{value}}"
  placeholder="请输入内容"
  bindinput="onInput"
  bindconfirm="onConfirm"
/>
```

### 通用属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| value | string | - | 输入框初始内容 |
| type | string | text | 输入类型 |
| password | boolean | false | 密码类型 |
| placeholder | string | - | 占位提示 |
| placeholder-style | string | - | 占位符样式 |
| disabled | boolean | false | 禁用 |
| maxlength | number | 140 | 最大长度，-1 为不限制 |
| cursor-spacing | number | 0 | 光标与键盘距离 |
| focus | boolean | false | 获取焦点 |
| confirm-type | string | done | 键盘右下角按钮文字 |
| confirm-hold | boolean | false | 点击完成不收起键盘 |
| cursor | number | - | 光标位置 |
| cursor-color | string | - | 光标颜色 |
| selection-start | number | -1 | 选区起始位置 |
| selection-end | number | -1 | 选区结束位置 |
| adjust-position | boolean | true | 键盘弹起时上推页面 |
| hold-keyboard | boolean | false | 点击页面不收起键盘 |

### type 属性值

| 值 | 说明 |
|----|------|
| text | 文本键盘 |
| number | 数字键盘 |
| idcard | 身份证键盘 |
| digit | 带小数点数字键盘 |
| nickname | 昵称键盘（2.21.2+） |

### confirm-type 属性值

| 值 | 按钮文字 |
|----|----------|
| send | 发送 |
| search | 搜索 |
| next | 下一个 |
| go | 前往 |
| done | 完成 |

### 通用事件

| 事件 | 说明 | detail |
|------|------|--------|
| bindinput | 输入时触发 | { value, cursor, keyCode } |
| bindchange | 内容改变（非聚焦） | { value } |
| bindfocus | 聚焦 | { value, height } |
| bindblur | 失焦 | { value } |
| bindconfirm | 点击完成按钮 | { value } |
| bindkeyboardheightchange | 键盘高度变化 | { height, duration } |

### Skyline 特有属性

| 属性 | 类型 | 说明 |
|------|------|------|
| bind:selectionchange | event | 选区改变事件 |
| bind:keyboardcompositionstart | event | 输入法开始输入 |
| bind:keyboardcompositionupdate | event | 输入法输入字符 |
| bind:keyboardcompositionend | event | 输入法输入结束 |
| worklet:onkeyboardheightchange | worklet | 键盘高度变化（UI线程） |

### Worklet 键盘回调

```html
<input
  value="{{value}}"
  worklet:onkeyboardheightchange="onKeyboardHeight"
/>
```

```javascript
Page({
  onKeyboardHeight(e) {
    'worklet'
    // 在 UI 线程执行，可实现同步动画
    const { height, pageBottomPadding } = e.detail
    // height: 键盘高度
    // pageBottomPadding: 页面上推高度
  }
})
```

**使用场景**：
- 键盘弹起时同步调整其他元素位置
- 实现自定义的键盘跟随动画

### 输入法组合事件

```html
<input
  bind:keyboardcompositionstart="onCompositionStart"
  bind:keyboardcompositionupdate="onCompositionUpdate"
  bind:keyboardcompositionend="onCompositionEnd"
/>
```

```javascript
Page({
  onCompositionStart(e) {
    // 输入法开始新的输入（如拼音输入开始）
    this.isComposing = true
  },
  
  onCompositionUpdate(e) {
    // 输入法正在输入（如拼音字母输入中）
  },
  
  onCompositionEnd(e) {
    // 输入法输入完成（如选择了中文字符）
    this.isComposing = false
  }
})
```

**使用场景**：
- 实时搜索时避免在拼音输入过程中触发搜索
- 联想输入时等待输入法完成再处理

### 选区变化事件

```html
<input bind:selectionchange="onSelectionChange" />
```

```javascript
Page({
  onSelectionChange(e) {
    const { selectionStart, selectionEnd } = e.detail
    // 可用于实现富文本工具栏状态同步
  }
})
```

## textarea 组件

`textarea` 的使用方式与 `input` 基本一致，主要区别：

### 特有属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| auto-height | boolean | false | 自动增高 |
| fixed | boolean | false | 在 position:fixed 区域时需设置 |
| show-confirm-bar | boolean | true | 是否显示完成栏 |

### 多行输入

```html
<textarea
  value="{{content}}"
  placeholder="请输入详细描述"
  auto-height
  maxlength="500"
  bindinput="onContentInput"
/>
```

## 示例代码

### 搜索框

```html
<view class="search-box">
  <input
    class="search-input"
    type="text"
    placeholder="搜索"
    confirm-type="search"
    value="{{keyword}}"
    bindinput="onSearchInput"
    bindconfirm="onSearch"
    bind:keyboardcompositionend="onCompositionEnd"
  />
  <view class="search-btn" bindtap="onSearch">搜索</view>
</view>
```

```javascript
Page({
  data: {
    keyword: '',
    isComposing: false
  },
  
  onSearchInput(e) {
    this.setData({ keyword: e.detail.value })
    // 非输入法组合状态下才触发实时搜索
    if (!this.isComposing) {
      this.doSearch(e.detail.value)
    }
  },
  
  onCompositionEnd(e) {
    this.isComposing = false
    this.doSearch(this.data.keyword)
  },
  
  onSearch() {
    this.doSearch(this.data.keyword)
  },
  
  doSearch(keyword) {
    // 执行搜索逻辑
  }
})
```

### 聊天输入框

```html
<view class="chat-input" style="padding-bottom: {{bottomPadding}}px;">
  <input
    class="input"
    value="{{message}}"
    placeholder="输入消息"
    confirm-type="send"
    hold-keyboard
    adjust-position="{{false}}"
    bindinput="onMessageInput"
    bindconfirm="sendMessage"
    worklet:onkeyboardheightchange="onKeyboardHeight"
  />
  <view class="send-btn" bindtap="sendMessage">发送</view>
</view>
```

```javascript
Page({
  data: {
    message: '',
    bottomPadding: 0
  },
  
  onKeyboardHeight(e) {
    'worklet'
    const { height } = e.detail
    // 使用 runOnJS 通知逻辑线程更新状态
    wx.worklet.runOnJS(() => {
      this.setData({ bottomPadding: height })
    })()
  },
  
  sendMessage() {
    if (!this.data.message.trim()) return
    // 发送消息
    this.setData({ message: '' })
  }
})
```

### 表单验证

```html
<view class="form-item">
  <text class="label">手机号</text>
  <input
    type="number"
    maxlength="11"
    placeholder="请输入手机号"
    value="{{phone}}"
    bindinput="onPhoneInput"
    bindblur="validatePhone"
  />
  <text wx:if="{{phoneError}}" class="error">{{phoneError}}</text>
</view>

<view class="form-item">
  <text class="label">验证码</text>
  <input
    type="number"
    maxlength="6"
    placeholder="请输入验证码"
    value="{{code}}"
    bindinput="onCodeInput"
  />
  <view 
    class="code-btn {{countdown > 0 ? 'disabled' : ''}}"
    bindtap="getCode"
  >
    {{countdown > 0 ? countdown + 's' : '获取验证码'}}
  </view>
</view>
```

## WebView 特有属性

以下属性仅在 WebView 下生效：

| 属性 | 说明 |
|------|------|
| placeholder-class | 占位符样式类 |
| safe-password-* | 安全键盘相关属性 |

## 注意事项

1. input 是原生组件，字体是系统字体，无法设置 font-family
2. 在 input 聚焦期间，避免使用 CSS 动画
3. 自定义组件中的 input 需要使用 `wx://form-field` behavior 才能被外层 form 获取
4. 键盘高度变化事件可能多次触发，应忽略相同高度值
5. Skyline 下 `cursor-color` 无限制，支持任意颜色值
