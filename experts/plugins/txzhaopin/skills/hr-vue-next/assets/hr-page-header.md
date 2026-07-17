# PageHeader 页头组件

页头组件，用于展示页面顶部的导航栏，包括 Logo、菜单列表、导航列表、用户信息等。

## 基础用法

### 基础示例

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-page-header :menuList="menuList" :activeMenu="activeMenu" showSearch showLangswitch logoName="HR系统名称" :avatarProps="{ username: 'cxyxhhuang(黄鑫杰)' }" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const activeMenu = ref('1');
const menuList = ref([
  { key: '1', link: 'https://hr-vue-next.pages.woa.com/vue-next/getting-started', text: '产品介绍' },
  { key: '2', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/page-footer', text: '解决方案' },
  { key: '3', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/avatar', text: '客户案例' },
  { key: '4', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/wecom', text: '关于我们' },
  { key: '5', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/lang-switch', text: '新闻动态' },
  { key: '6', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/privacy-switch', text: '服务支持' },
  { key: '7', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/countdown-button', text: '联系我们' }
]);
</script>
<style lang="less" scoped>
.block {
  display: block;
}
</style>
```

### 自定义 Logo

通过插槽自定义 Logo 区域。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-page-header :avatarProps="{ username: 'cxyxhhuang(黄鑫杰)' }" showSearch showLangswitch>
        <template #logoSrc>
          <div></div>
        </template>
        <template #logoName>
          <img :src="Logo" alt="" style="height: 28px;margin-right: 20px;">
        </template>
      </hr-page-header>
    </div>
  </div>
</template>
<script setup>
import Logo from '@components/theme-grace/img/logo.svg'; 
</script>
<style lang="less" scoped>
.block {
  display: block;
}
</style>
```

### 菜单激活状态

通过 `activeMenu` 属性设置当前激活的菜单项，与菜单项的 `key` 值对应。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-page-header :menuList="menuList" :active-menu="activeMenu" logoName="HR系统名称" showSearch showLangswitch :avatarProps="{ username: 'cxyxhhuang(黄鑫杰)' }" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const activeMenu = ref('1');
const menuList = ref([
  { key: '1', link: 'https://hr-vue-next.pages.woa.com/vue-next/getting-started', text: '产品介绍' },
  { key: '2', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/page-footer', text: '解决方案' },
  { key: '3', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/avatar', text: '客户案例' },
  { key: '4', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/wecom', text: '关于我们' },
  { key: '5', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/lang-switch', text: '新闻动态' },
  { key: '6', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/privacy-switch', text: '服务支持' },
  { key: '7', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/countdown-button', text: '联系我们' }
]);
</script>
<style lang="less" scoped>
.block {
  display: block;
}
</style>
```

### 链接跳转方式

通过菜单项的 `target` 属性设置链接跳转方式。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-page-header :menuList="menuList" :navitationList="navitationList" logoName="HR系统名称" showSearch showLangswitch :operationList="operationList" :avatarProps="{ username: 'cxyxhhuang(黄鑫杰)' }" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const menuList = ref([
  { target: '_blank', link: 'https://hr-vue-next.pages.woa.com/vue-next/getting-started', text: '产品介绍' },
  { target: '_blank', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/page-footer', text: '解决方案' },
  { target: '_blank', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/avatar', text: '客户案例' },
  { target: '_blank', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/wecom', text: '关于我们' },
  { target: '_blank', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/lang-switch', text: '新闻动态' },
  { target: '_blank', link: 'https://hr-vue-next.pages.woa.com/vue-next/components/privacy-switch', text: '服务支持' },
  {
    target: '_blank',
    link: 'https://hr-vue-next.pages.woa.com/vue-next/components/countdown-button',
    text: '联系我们',
  },
]);
const navitationList = ref([
  {
    text: '自助服务',
    children: [
      {
        text: '鹅知',
        link: 'https://hr.woa.com/hrcms/#/More',
        target: '_blank',
      },
      {
        text: '我要休假',
        link: 'https://holiday.woa.com/index',
        target: '_blank',
      },
      {
        text: '证明办理',
        link: 'https://essc.woa.com/subHome/proof',
        target: '_blank',
      },
      {
        text: '加班申请',
        link: 'https://hrot.woa.com/ot/MyOvertime',
        target: '_blank',
      },
      {
        text: '腾讯阳光平台',
        link: 'https://yangguang.woa.com/#/Main/Home',
        target: '_blank',
      },
    ],
  },
  {
    text: '招聘活水',
    children: [
      {
        text: '首页',
        link: 'https://zhaopin.woa.com/zhaopin/home',
        target: '_blank',
      },
      {
        text: '社招伯乐推荐',
        link: 'https://bole.woa.com/bole/home',
        target: '_blank',
      },
      {
        text: '校招伯乐推荐',
        link: 'http://campus.oa.com/center/bole/index',
        target: '_blank',
      },
      {
        text: '活水平台',
        link: 'https://huoshui.woa.com/hsPlatform/home',
        target: '_blank',
      },
      {
        text: '编制管理系统',
        link: 'https://hc.woa.com',
        target: '_blank',
      },
    ],
  },
  {
    text: '学习发展',
    children: [
      {
        text: 'Q-learning',
        link: 'https://portal.learn.woa.com/user/home',
        target: '_blank',
      },
      {
        text: '行家',
        link: 'https://hangjia.woa.com',
        target: '_blank',
      },
      {
        text: '通道标准',
        link: 'https://portal.learn.woa.com/user/special?page_id=414&lang=zh',
        target: '_blank',
      },
      {
        text: 'IDP课程',
        link: 'https://learn.woa.com/user/idp',
        target: '_blank',
      },
      {
        text: '讲师申请',
        link: 'https://lec.learn.woa.com/#/staff/apply',
        target: '_blank',
      },
      {
        text: 'Hi HR平台',
        link: 'https://s3.woa.com/',
        target: '_blank',
      },
    ],
  },
  {
    text: '组织与人才发展',
    children: [
      {
        text: '人才评估',
        link: 'https://tps.woa.com/assess/Index',
        target: '_blank',
      },
      {
        text: '目标管理',
        link: 'https://goal.woa.com/goal',
        target: '_blank',
      },
      {
        text: '全面反馈',
        link: 'https://tps.woa.com/ca/Index',
        target: '_blank',
      },
      {
        text: '职级评定',
        link: 'https://ppe.woa.com',
        target: '_blank',
      },
      {
        text: '能下系统',
        link: 'http://tps.oa.com/mrm/DeclarationDetails',
        target: '_blank',
      },
      {
        text: '汇报链精准运营系统',
        link: 'https://hr-core.woa.com/web/core/superOrgView',
        target: '_blank',
      },
      {
        text: 'E系统',
        link: 'http://hr.oa.com/v2/EProject/Task.html',
        target: '_blank',
      },
    ],
  },
  {
    text: '薪酬福利',
    children: [
      {
        text: '鹅民公社',
        link: 'https://flex.woa.com/',
        target: '_blank',
      },
      {
        text: '工资单查询',
        link: 'https://pay.woa.com/staff/sbc/salary',
        target: '_blank',
      },
      {
        text: '安居计划',
        link: 'https://txfuli.woa.com/housingplan/My/ApplyUser',
        target: '_blank',
      },
      {
        text: '礼金申请指南',
        link: 'https://km.woa.com/articles/show/364030?from=iSearch',
        target: '_blank',
      },
      {
        text: '年末激励查询',
        link: 'https://pay.woa.com/staff/sbc/incentive/bonus',
        target: '_blank',
      },
      {
        text: '调薪记录查询',
        link: 'https://pay.woa.com/staff/sbc/salary/salary-change',
        target: '_blank',
      },
      {
        text: '证券账户维护',
        link: 'https://pay.woa.com/staff/sbc/account',
        target: '_blank',
      },
      {
        text: '长期激励查询',
        link: 'https://pay.woa.com/staff/lti/index',
        target: '_blank',
      },
    ],
  },
  {
    text: '人事管理',
    children: [
      {
        text: 'HR权限申请',
        link: 'https://hrright.woa.com/home',
        target: '_blank',
      },
      {
        text: 'BP工作台',
        link: 'https://hrbp.woa.com',
        target: '_blank',
      },
      {
        text: 'HR数据服务',
        link: 'https://diy.woa.com/',
        target: '_blank',
      },
      {
        text: 'PeopleSoft',
        link: 'https://hrps.woa.com',
        target: '_blank',
      },
      {
        text: '申请离职（场）',
        link: 'https://new-hm.woa.com/dimission/resignationProcess/selfApply',
        target: '_blank',
      },
      {
        text: '申请调动',
        link: 'https://new-hm.woa.com/move/home/first',
        target: '_blank',
      },
      {
        text: '人事合同管理系统',
        link: 'https://new-hm.woa.com/contract',
        target: '_blank',
      },
      {
        text: '申请外包入场',
        link: 'https://new-hm.woa.com/register/ProjectOutSouceApplyPage?type=OutsourcingApplyPage',
        target: '_blank',
      },
      {
        text: '申请合作伙伴入场',
        link: 'https://new-hm.woa.com/register/ProjectOutSouceApplyPage?type=CooperativePartner',
        target: '_blank',
      },
      {
        text: '发起申诉',
        link: 'https://shensu.woa.com',
        target: '_blank',
      },
    ],
  },
]);
const operationList = ref([
  {
    text: '个人中心',
    link: 'https://hr-vue-next.pages.woa.com/vue-next/getting-started',
    target: '_blank',
  },
]);
</script>
<style lang="less" scoped>
.block {
  display: block;
}
</style>
```

### 不显示菜单列表

不传入 `menuList` 属性即可不显示菜单列表。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-page-header logoName="HR系统名称" showSearch showLangswitch :avatarProps="{ username: 'cxyxhhuang(黄鑫杰)' }"/>
    </div>
  </div>
</template>
<style lang="less" scoped>
.block {
  display: block;
}
</style>
```

### 不显示用户操作区

设置 `showNavigation` 为 `false` 可隐藏用户操作区。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-page-header logoName="HR系统名称" :showNavigation="false" :avatarProps="{ username: 'cxyxhhuang(黄鑫杰)' }" />
    </div>
  </div>
</template>
<style lang="less" scoped>
.block {
  display: block;
}
</style>
```

## API

### Props

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| logoSrc | logo 链接 | String/slot | - | - |
| logoName | logo 名称 | String/slot | - | - |
| activeMenu | 菜单列表选中项，与菜单项的key值对应 | String/Number | - | - |
| menuList | 菜单列表，类型：[INavitation[]](#inavitation类型) | Array | - | - |
| navitationList | 导航列表，类型：[INavitation[]](#inavitation类型) | Array | - | - |
| operationList | 用户信息下拉列表，类型：[INavitation[]](#inavitation类型) | Array | - | - |
| minMenuWidth | 菜单显示最小宽度 | String | - | 100px |
| showSearch | 是否显示搜索 | Boolean | - | false |
| showLangswitch | 是否显示语言切换 | Boolean | - | false |
| rightContent | 右侧插槽，包裹搜索和语言切换模块 | slot | - | - |
| langSwitchProps | 语言切换的props，详情请见：[LangSwitch组件props](/vue-next/components/lang-switch?tab=api) | Object | - | - |
| avatarProps | 头像组件的props，详情请见：[Avatar组件props](/vue-next/components/avatar?tab=api) | Object | - | - |

### Events

| 事件名称 | 说明 | 回调参数 |
| --- | --- | --- |
| navigationClick | 点击导航时触发 | 当前的导航 item |
| menuItemClick | 点击菜单时触发 | 当前的菜单 item |
| operationClick | 点击用户信息下拉菜单时触发 | 当前的下拉菜单 item |
| onSearch | 点击搜索按钮或者输入框聚焦回车时触发 | 当前的输入值 |
| onLangSwitch | 语言切换点击时触发 | 当前的切换语言 |

### Slots

| 插槽名 | 说明 |
| --- | --- |
| logoSrc | 自定义 logo 图片区域 |
| logoName | 自定义 logo 名称区域 |
| rightContent | 自定义右侧内容区域 |

## INavitation 类型

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| link | 跳转链接 | String | - | - |
| text | 菜单名称 | String | - | - |
| key | 菜单唯一key，菜单列表需要选中项激活时此参数必传 | String/Number | - | - |
| target | 链接跳转方式 | String | _blank/_self/_parent/_top | _self |
| onClick | 点击跳转方法，传入时点击对应item不走组件默认跳转方法，走传入的方法。回调参数为对应的item | Function | - | - |
| children | 子菜单列表（仅 navitationList 支持） | INavitation[] | - | - |
