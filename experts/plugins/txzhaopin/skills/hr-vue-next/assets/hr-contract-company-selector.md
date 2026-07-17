# HrContractCompanySelector 合同公司选择器

## 组件说明

使用下拉菜单展示合同公司的选项并选择内容。

## 基础单选

```vue
<template>
  <div class="example_init_box">
    <hr-contract-company-selector v-model="value" placeholder="请选择" @change="change"/>
    </div>
</template>
<script setup>
import { ref } from 'vue';
const value = ref(1);
const change = (val) => {
  console.log(val);
}
</script>
<style lang="less" scoped></style>
```

## 基础多选

```vue
<template>
    <div class="example_flex_box">
        <div class="block">
        <hr-contract-company-selector v-model="value1" :map="map"/>
      </div>
      <div class="block">
        <hr-contract-company-selector
          v-model="value2"
          :map="map"
          :tagsLength="3"
          :filterable="false"
          collapse-tags
        />
      </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref([]);
const value2 = ref([]);
const map = { multiple: true };
</script>

<style lang="less" scoped></style>
```

## 尺寸

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">默认尺寸</span>
      <hr-contract-company-selector v-model="value1" />
    </div>
    <div class="block">
      <span class="demonstration">默认尺寸</span>
      <hr-contract-company-selector size="medium" v-model="value2" />
    </div>
    <div class="block">
      <span class="demonstration">较小尺寸</span>
      <hr-contract-company-selector size="small" v-model="value3" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref('');
const value3 = ref('');
</script>
<style lang="less" scoped></style>
```

## 自定义选项

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-contract-company-selector v-model="value1" :data="remoteData" :map="map"/>
    </div>
    <div class="block">
      <hr-contract-company-selector v-model="value2" :promise="promise" :map="map"/>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref('');
const map = {
  label: "name",
  value: "mark"
}
const remoteData = [
  { name: '测试有限公司', mark: '1' },
  { name: '合同有限公司', mark: '2' },
  { name: '深圳有限公司', mark: '3' }
]
const promise = new Promise((resolve, reject) => {
  setTimeout(() => {
    resolve(remoteData);
  }, 300)
})
</script>
<style lang="less" scoped></style>
```

## API

### 属性 (Props)

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| v-model / modelValue | 绑定值 | Array / String / Number | — | — |
| size | 输入框尺寸 | String | medium / small | — |
| disabled | 是否禁用 | Boolean | — | false |
| lang | 语言 | String | 中文: zh，英文: en | zh |
| collapseTags | 多选模式下是否折叠Tag | Boolean | — | false |
| tagsLength | Tag最大展示文字数, 最小1 | Number | — | 13 |
| showTotal | 多选时是否显示后置的已选数量 | Boolean | — | false |
| placeholder | 占位符 | String | — | — |
| filterable | 是否可搜索选项 | Boolean | — | true |
| map | 映射配置，具体见下表 | Object | — | — |
| promise | 获取合同公司数据的方法 | Promise | — | — |
| customClass | 自定义类名 | String | — | — |

### map 映射配置

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| multiple | 是否多选 | Boolean | — | false |
| value | 指定选项的值为选项对象的某个属性值 | String | — | 'value' |
| label | 指定选项标签为选项对象的某个属性值 | String | — | 'label' |

### 事件 (Events)

| 事件名称 | 说明 | 回调参数 |
| --- | --- | --- |
| change | 选中项发生变化时触发 | 目前的选中项, 包含label、value |
