#!/usr/bin/env node
/**
 * 用户档案管理脚本 - 支持家庭成员
 * 保存/读取用户命理数据及家庭成员
 */

const fs = require('fs');
const path = require('path');

const PROFILES_DIR = path.join(__dirname, '../data/profiles');

// 确保目录存在
if (!fs.existsSync(PROFILES_DIR)) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

/**
 * 获取用户档案路径
 */
function getProfilePath(userId) {
  return path.join(PROFILES_DIR, `${userId}.json`);
}

/**
 * 读取用户档案
 */
function loadProfile(userId) {
  const filePath = getProfilePath(userId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const data = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(data);
}

/**
 * 保存用户档案
 */
function saveProfile(userId, data) {
  const filePath = getProfilePath(userId);
  const profile = {
    ...data,
    userId,
    updatedAt: new Date().toISOString().split('T')[0]
  };
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');
  return profile;
}

/**
 * 更新档案字段
 */
function updateProfile(userId, field, value) {
  const profile = loadProfile(userId) || {};
  
  // 处理嵌套字段如 "family.spouse.name"
  const fields = field.split('.');
  let current = profile;
  
  for (let i = 0; i < fields.length - 1; i++) {
    if (!current[fields[i]]) {
      current[fields[i]] = {};
    }
    current = current[fields[i]];
  }
  
  current[fields[fields.length - 1]] = value;
  
  saveProfile(userId, profile);
  console.log(`✅ 已更新: ${field} = ${value}`);
}

/**
 * 添加家庭成员
 */
function addFamilyMember(userId, type, name, data = {}) {
  const profile = loadProfile(userId);
  if (!profile) {
    console.log(`❌ 用户档案不存在: ${userId}`);
    return;
  }
  
  if (!profile.family) {
    profile.family = {};
  }
  
  const memberData = {
    name,
    profile: {
      birthDate: data.birthDate || '待录入',
      birthTime: data.birthTime || '待录入',
      birthPlace: data.birthPlace || '',
      gender: data.gender || '',
      lunarBirth: data.lunarBirth || ''
    },
    bazi: {
      year: data.year || '',
      month: data.month || '',
      day: data.day || '',
      hour: data.hour || '',
      dayStem: data.dayStem || '',
      zodiac: data.zodiac || '',
      sect: data.sect || '晚子时',
      source: 'pending'
    },
    relationship: type,
    addedAt: new Date().toISOString().split('T')[0]
  };
  
  if (type === 'children') {
    if (!profile.family.children) {
      profile.family.children = [];
    }
    profile.family.children.push(memberData);
    console.log(`✅ 已添加子女: ${name}`);
  } else {
    profile.family[type] = memberData;
    console.log(`✅ 已添加${type}: ${name}`);
  }
  
  saveProfile(userId, profile);
}

/**
 * 添加子女
 */
function addChild(userId, name, birthDate, gender) {
  const profile = loadProfile(userId);
  if (!profile) {
    console.log(`❌ 用户档案不存在: ${userId}`);
    return;
  }
  
  const child = {
    name,
    profile: {
      birthDate: birthDate || '待录入',
      birthTime: '待录入',
      birthPlace: '',
      gender: gender || '',
      lunarBirth: ''
    },
    bazi: {
      year: '',
      month: '',
      day: '',
      hour: '',
      source: 'pending'
    },
    relationship: '子女',
    addedAt: new Date().toISOString().split('T')[0]
  };
  
  if (!profile.family) profile.family = {};
  if (!profile.family.children) profile.family.children = [];
  
  profile.family.children.push(child);
  saveProfile(userId, profile);
  console.log(`✅ 已添加子女: ${name} (${gender || '待定'})`);
}

/**
 * 列出家庭成员
 */
function listFamilyMembers(userId) {
  const profile = loadProfile(userId);
  if (!profile) {
    console.log(`❌ 用户档案不存在: ${userId}`);
    return;
  }
  
  console.log(`\n👪 家庭成员列表 (${profile.name})\n`);
  
  const { family } = profile;
  
  if (family?.spouse?.name && family.spouse.name !== '配偶') {
    console.log(`  👫 配偶: ${family.spouse.name}`);
    console.log(`     八字: ${family.spouse.bazi?.year || '?'} ${family.spouse.bazi?.month || ''} ${family.spouse.bazi?.day || ''} ${family.spouse.bazi?.hour || ''}`);
  }
  
  if (family?.father?.name && family.father.name !== '父亲') {
    console.log(`  👨 父亲: ${family.father.name}`);
    console.log(`     八字: ${family.father.bazi?.year || '?'} ${family.father.bazi?.month || ''} ${family.father.bazi?.day || ''} ${family.father.bazi?.hour || ''}`);
  }
  
  if (family?.mother?.name && family.mother.name !== '母亲') {
    console.log(`  👩 母亲: ${family.mother.name}`);
    console.log(`     八字: ${family.mother.bazi?.year || '?'} ${family.mother.bazi?.month || ''} ${family.mother.bazi?.day || ''} ${family.mother.bazi?.hour || ''}`);
  }
  
  if (family?.children?.length > 0) {
    console.log(`  👶 子女 (${family.children.length}):`);
    family.children.forEach((child, i) => {
      console.log(`     ${i + 1}. ${child.name} (${child.profile?.gender || '待定'})`);
      console.log(`        出生: ${child.profile?.birthDate || '待录入'}`);
      console.log(`        八字: ${child.bazi?.year || '?'} ${child.bazi?.month || ''} ${child.bazi?.day || ''} ${child.bazi?.hour || ''}`);
    });
  }
  
  if (!family?.spouse && !family?.father && !family?.mother && (!family?.children || family.children.length === 0)) {
    console.log(`  (暂无家庭成员记录)`);
  }
  
  console.log('');
}

/**
 * 显示完整档案
 */
function showProfile(userId) {
  const profile = loadProfile(userId);
  if (!profile) {
    console.log(`❌ 用户档案不存在: ${userId}`);
    return;
  }
  
  console.log('\n📋 用户档案\n');
  console.log(`ID: ${profile.userId}`);
  console.log(`姓名: ${profile.name}`);
  console.log(`出生: ${profile.profile?.birthDate} ${profile.profile?.birthTime}`);
  console.log(`地点: ${profile.profile?.birthPlace}`);
  console.log(`性别: ${profile.profile?.gender}`);
  
  console.log('\n🧮 八字');
  console.log(`  ${profile.bazi?.year} ${profile.bazi?.month} ${profile.bazi?.day} ${profile.bazi?.hour}`);
  console.log(`  日主: ${profile.bazi?.dayStem}`);
  console.log(`  生肖: ${profile.bazi?.zodiac}`);
  
  if (profile.ziwei) {
    console.log('\n✨ 紫微');
    console.log(`  命宫: ${profile.ziwei.mingGong}`);
    console.log(`  命主: ${profile.ziwei.mingZhu}`);
  }
  
  listFamilyMembers(userId);
}

/**
 * 列出所有用户
 */
function listProfiles() {
  const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
  console.log('\n📋 用户列表\n');
  
  files.forEach(f => {
    const userId = f.replace('.json', '');
    const data = loadProfile(userId);
    console.log(`  ${userId} | ${data?.name || '未知'} | ${data?.profile?.birthDate || '未知'}`);
  });
  
  console.log(`\n共 ${files.length} 个用户\n`);
}

/**
 * 删除档案
 */
function deleteProfile(userId) {
  const filePath = getProfilePath(userId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`✅ 已删除: ${userId}`);
  } else {
    console.log(`❌ 档案不存在: ${userId}`);
  }
}

// 主入口
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'show':
  case 'load':
    if (args[1]) {
      showProfile(args[1]);
    } else {
      console.log('用法: node profile.js show <userId>');
    }
    break;
    
  case 'list':
    listProfiles();
    break;
    
  case 'save':
    if (args.length < 4) {
      console.log('用法: node profile.js save <userId> <field> <value>');
      console.log('示例: node profile.js save 123 name 张三');
      console.log('      node profile.js save 123 bazi.day 戊子');
    } else {
      updateProfile(args[1], args[2], args[3]);
    }
    break;
    
  case 'add':
    // node profile.js add <userId> <type> <name> [birthDate] [gender]
    if (args.length < 4) {
      console.log('用法:');
      console.log('  node profile.js add <userId> spouse <name> [出生日期] [性别]');
      console.log('  node profile.js add <userId> father <name> [出生日期]');
      console.log('  node profile.js add <userId> mother <name> [出生日期]');
      console.log('  node profile.js add <userId> child <name> <出生日期> <性别>');
      console.log('');
      console.log('示例:');
      console.log('  node profile.js add 123 spouse 李四 1990-05-15 女');
      console.log('  node profile.js add 123 child 子女姓名 2020-01-01 男');
    } else {
      const userId = args[1];
      const type = args[2];
      const name = args[3];
      
      if (type === 'child') {
        const birthDate = args[4];
        const gender = args[5];
        addChild(userId, name, birthDate, gender);
      } else {
        addFamilyMember(userId, type, name, {
          birthDate: args[4],
          gender: type === 'spouse' ? (args[5] || '女') : (args[4] ? '男' : '')
        });
      }
    }
    break;
    
  case 'family':
    if (args[1]) {
      listFamilyMembers(args[1]);
    } else {
      console.log('用法: node profile.js family <userId>');
    }
    break;
    
  case 'delete':
    if (args[1]) {
      deleteProfile(args[1]);
    } else {
      console.log('用法: node profile.js delete <userId>');
    }
    break;
    
  default:
    console.log(`
🗂️ 用户档案管理 (支持家庭成员)

用法:
  node profile.js show <userId>              显示完整档案
  node profile.js list                        列出所有用户
  node profile.js save <userId> <field> <value>  保存字段
  node profile.js add <userId> <type> <name> [参数]  添加家庭成员
  node profile.js family <userId>            显示家庭成员
  node profile.js delete <userId>            删除档案

家庭成员类型:
  spouse   - 配偶
  father   - 父亲
  mother   - 母亲
  child    - 子女

示例:
  # 查看档案
  node profile.js show 123456

  # 添加配偶
  node profile.js add 123456 spouse 配偶姓名 1990-05-15 女

  # 添加子女
  node profile.js add 123456 child 子女姓名 2020-01-01 男

  # 添加父亲
  node profile.js add 123456 father 父亲姓名 1950-03-15

  # 查看家庭成员
  node profile.js family 123456

  # 保存八字
  node profile.js save 123456 family.spouse.bazi.year 庚午
`);
}

module.exports = { loadProfile, saveProfile, updateProfile, addFamilyMember, addChild, listFamilyMembers, showProfile };
