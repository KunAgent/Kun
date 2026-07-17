#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCES_DIR = join(__dirname, '..', 'references');

const COST_FILENAMES = ['机型_成本优先.json', '机型_成本优先推荐.json'];

function loadJSON(filepath) {
  return JSON.parse(readFileSync(filepath, 'utf-8'));
}

function getVendorDirs(dataDir) {
  return readdirSync(dataDir)
    .filter(name => statSync(join(dataDir, name)).isDirectory())
    .sort();
}

function buildInstanceTypeLines(dataDir) {
  const lines = [];

  for (const vendor of getVendorDirs(dataDir)) {
    const vendorDir = join(dataDir, vendor);

    const standardFile = join(vendorDir, '机型_标准推荐.json');
    if (existsSync(standardFile)) {
      for (const line of expandInstances(vendor, loadJSON(standardFile), '标准推荐')) {
        lines.push(line);
      }
    }

    for (const costFile of COST_FILENAMES) {
      const costPath = join(vendorDir, costFile);
      if (existsSync(costPath)) {
        for (const line of expandInstances(vendor, loadJSON(costPath), '成本优先')) {
          lines.push(line);
        }
        break;
      }
    }
  }

  return lines;
}

function expandInstances(vendor, records, strategy) {
  const lines = [];
  for (const rec of records) {
    const srcType = rec.SrcInstanceType || '';
    const tencentType = rec.TencentInstanceType || '';
    const tencentFamilies = rec.TencentInstanceFamily.join(', ');

    for (const family of rec.SrcInstanceFamily) {
      const srcPart = srcType
        ? `${vendor} ${srcType} (${family})`
        : `${vendor} (${family})`;
      const dstPart = tencentType
        ? `腾讯云${tencentType} (${tencentFamilies})`
        : `腾讯云 (${tencentFamilies})`;
      lines.push(`${srcPart} => ${dstPart} 策略：${strategy}`);
    }
  }
  return lines;
}

function buildRegionLines(dataDir) {
  const lines = [];

  for (const vendor of getVendorDirs(dataDir)) {
    const regionFile = join(dataDir, vendor, '地域.json');
    if (!existsSync(regionFile)) continue;

    for (const rec of loadJSON(regionFile)) {
      const srcId = rec.SrcRegionID;
      const srcName = rec.SrcRegionName;
      const dstId = rec.TencentRegionID;
      const dstName = rec.TencentRegionName;
      lines.push(`${vendor} ${srcId} (${srcName}) => 腾讯云 ${dstId} (${dstName})`);
    }
  }

  return lines;
}

function buildDiskLines(dataDir) {
  const lines = [];

  for (const vendor of getVendorDirs(dataDir)) {
    const diskFile = join(dataDir, vendor, '磁盘.json');
    if (!existsSync(diskFile)) continue;

    for (const rec of loadJSON(diskFile)) {
      const srcType = rec.SrcDiskType;
      const srcName = rec.SrcDiskTypeCN;

      for (const td of rec.TencentDisks) {
        const category = td.DiskCategory.join(', ');
        lines.push(
          `${vendor} ${srcType} (${srcName}) => 腾讯云 ${td.TencentDiskType} (${td.TencentDiskTypeCN}) 用途：${category}`
        );
      }
    }
  }

  return lines;
}

function writeReference(filename, title, description, lines) {
  const header = `# ${title}\n\n${description}\n\n`;
  const content = header + lines.join('\n') + '\n';
  const outPath = join(REFERENCES_DIR, filename);
  writeFileSync(outPath, content, 'utf-8');
  console.log(`  ${filename}: ${lines.length} 条映射`);
}

function main() {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('用法: node build-references.mjs <JSON数据目录>');
    console.error('示例: node build-references.mjs /path/to/20251209');
    process.exit(1);
  }

  if (!existsSync(dataDir)) {
    console.error(`错误: 目录不存在 ${dataDir}`);
    process.exit(1);
  }

  const vendors = getVendorDirs(dataDir);
  console.log(`数据目录: ${dataDir}`);
  console.log(`发现厂商: ${vendors.join(', ')}\n`);

  writeReference(
    'instance-type.md',
    '机型映射（实例规格族）',
    '友商云实例规格族到腾讯云对标规格族的映射。每行格式：\n`<厂商> [类型] (<源规格族>) => 腾讯云<类型> (<腾讯云规格族>) 策略：<标准推荐|成本优先>`',
    buildInstanceTypeLines(dataDir)
  );

  writeReference(
    'region.md',
    '地域映射',
    '友商云地域到腾讯云地域的映射。每行格式：\n`<厂商> <源地域ID> (<源地域名>) => 腾讯云 <腾讯云地域ID> (<腾讯云地域名>)`',
    buildRegionLines(dataDir)
  );

  writeReference(
    'disk.md',
    '磁盘映射',
    '友商云磁盘类型到腾讯云磁盘类型的映射。每行格式：\n`<厂商> <源磁盘类型> (<源磁盘名>) => 腾讯云 <腾讯云磁盘类型> (<腾讯云磁盘名>) 用途：<system|data>`',
    buildDiskLines(dataDir)
  );

  console.log('\n完成！');
}

main();
