#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import https from "https";
import { URL } from "url";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// ============================================================
// 360 点睛搜索推广 MCP Server
// 基于 360 点睛营销开放平台 API 封装
// API 文档: https://open.e.360.cn/api/
// ============================================================

const API_BASE = "https://api.e.360.cn";

// 读取多账户配置
function loadAccounts() {
  const configPath = path.join(path.dirname(process.argv[1] || __filename), "accounts.json");
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (e) {
      console.error("读取账户配置失败:", e.message);
    }
  }
  return { accounts: [] };
}

// Token 持久化
const TOKEN_FILE = path.join(path.dirname(process.argv[1] || __filename), "tokens.json");
function loadTokens() {
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    } catch (e) {}
  }
  return {};
}
function saveTokens(tokens) {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  } catch (e) {
    console.error("保存 Token 失败:", e.message);
  }
}

// ---- HTTP helper ----
function httpRequest(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isGet = !data;
    const body = data ? new URLSearchParams(data).toString() : null;
    const opts = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: isGet ? "GET" : "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          resolve({ raw: Buffer.concat(chunks).toString() });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpPostJson(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = JSON.stringify(data);
    const opts = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          resolve({ raw: Buffer.concat(chunks).toString() });
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---- 360 登录密码加密（2026-05-28 验证通过） ----
// 1. MD5(原始密码) → 32位 hex 字符串
// 2. AES-128-CBC 加密该 hex 字符串（作为 UTF-8 文本，恰好32字节，无需padding）
//    Key = apiSecret 前16字符
//    IV  = apiSecret 后16字符
// 3. 输出 64位 hex
function encryptPassword(password, apiSecret) {
  const md5Hex = crypto.createHash("md5").update(password).digest("hex");
  const key = apiSecret.substring(0, 16);
  const iv = apiSecret.substring(16, 32);
  const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(key), Buffer.from(iv));
  cipher.setAutoPadding(false);
  // MD5 hex 字符串本身就是32字节ASCII，直接加密
  let encrypted = cipher.update(Buffer.from(md5Hex, "utf8")).toString("hex");
  encrypted += cipher.final("hex");
  return encrypted; // 64位 hex
}

// ---- 360 API caller ----
const tokenStore = loadTokens();

async function call360Api(path, data = null, accountName = null) {
  const tokenKey = accountName || Object.keys(tokenStore)[0];
  const token = tokenStore[tokenKey];
  if (!token) {
    return { error: `账户 [${tokenKey}] 未登录，请先调用 login 工具` };
  }
  const accountEntry = getAccountByLabel(tokenKey);
  const apiKey = accountEntry?.apiKey || "";
  const headers = {
    apiKey,
    accessToken: token,
  };
  const url = `${API_BASE}${path}`;
  if (data) {
    return httpRequest(url, data, headers);
  }
  return httpRequest(url, null, headers);
}

function getAccountByLabel(label) {
  const config = loadAccounts();
  return config.accounts?.find((a) => a.label === label);
}

// ============================================================
// MCP Server Setup
// ============================================================

const server = new McpServer({
  name: "qihu-ads",
  version: "1.1.0",
  description: "360 点睛搜索推广 MCP Server",
});

// ---- 启动时自动登录所有账户 ----
async function autoLoginAll() {
  const config = loadAccounts();
  const results = [];
  for (const account of config.accounts || []) {
    if (!account.enabled) continue;
    try {
      const encryptedPwd = encryptPassword(account.password, account.apiSecret);
      const result = await httpRequest(
        `${API_BASE}/account/clientLogin`,
        { username: account.username, passwd: encryptedPwd },
        { apiKey: account.apiKey }
      );
      if (result.accessToken) {
        tokenStore[account.label] = result.accessToken;
        results.push(`✅ ${account.label} 登录成功`);
      } else {
        results.push(`❌ ${account.label} 登录失败: ${JSON.stringify(result)}`);
      }
    } catch (e) {
      results.push(`❌ ${account.label} 登录异常: ${e.message}`);
    }
  }
  saveTokens(tokenStore);
  console.error(`\n=== 360 MCP 启动 ===\n${results.join("\n")}\n===================\n`);
}
autoLoginAll();

// ---- 每8小时自动重新登录（accessToken 10小时有效） ----
setInterval(() => {
  console.error("[360 MCP] 定时刷新 token...");
  autoLoginAll();
}, 8 * 60 * 60 * 1000);

// ---- Auth Tools ----

server.tool(
  "login",
  "登录 360 点睛账户获取 accessToken（自动加密密码）",
  {
    username: z.string().describe("360 点睛账户名"),
    password: z.string().describe("登录密码（明文，自动加密）"),
    api_key: z.string().describe("ApiKey"),
    api_secret: z.string().describe("ApiSecret"),
    account_label: z.string().optional().describe("账户标签（用于多账户区分，默认用 username）"),
  },
  async ({ username, password, api_key, api_secret, account_label }) => {
    const encryptedPwd = encryptPassword(password, api_secret);
    const result = await httpRequest(
      `${API_BASE}/account/clientLogin`,
      { username, passwd: encryptedPwd },
      { apiKey: api_key }
    );
    if (result.accessToken) {
      const label = account_label || username;
      tokenStore[label] = result.accessToken;
      saveTokens(tokenStore);
      return {
        content: [{ type: "text", text: `✅ 登录成功！\n账户: ${label}\nuid: ${result.uid}\naccessToken: ${result.accessToken.substring(0, 20)}...\n\n已保存 Token，可以开始使用广告管理工具了。` }],
      };
    }
    return { content: [{ type: "text", text: `❌ 登录失败:\n${JSON.stringify(result, null, 2)}` }] };
  }
);

server.tool(
  "list_accounts",
  "列出当前已登录的 360 账户",
  {},
  async () => {
    const accounts = Object.keys(tokenStore);
    if (accounts.length === 0) {
      return { content: [{ type: "text", text: "当前没有已登录的账户。请先调用 login 工具。" }] };
    }
    return {
      content: [{ type: "text", text: `已登录 ${accounts.length} 个账户:\n${accounts.map((a, i) => `${i + 1}. ${a}`).join("\n")}` }],
    };
  }
);

// ---- Account Tools ----

server.tool(
  "get_account_info",
  "获取 360 推广账户信息（余额、预算、状态等）",
  { account: z.string().optional().describe("账户标签（多账户时指定）") },
  async ({ account }) => {
    const result = await call360Api("/uc/account/getInfo", null, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_balance",
  "获取 360 账户余额信息",
  { account: z.string().optional().describe("账户标签") },
  async ({ account }) => {
    const result = await call360Api("/uc/account/getBalance", null, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_funds",
  "获取账户资金信息",
  { account: z.string().optional().describe("账户标签") },
  async ({ account }) => {
    const result = await call360Api("/uc/account/getFunds", null, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Campaign Tools ----

server.tool(
  "list_campaigns",
  "获取搜索推广计划列表",
  {
    account: z.string().optional().describe("账户标签"),
    campaign_ids: z.array(z.number()).optional().describe("指定计划 ID 列表"),
  },
  async ({ account, campaign_ids }) => {
    const data = campaign_ids?.length ? { campaignIds: campaign_ids } : {};
    const result = await call360Api("/search/campaign/getCampaign", data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "create_campaign",
  "创建搜索推广计划",
  {
    account: z.string().optional().describe("账户标签"),
    campaign_name: z.string().describe("计划名称"),
    budget: z.number().describe("日预算（元）"),
    region: z.string().optional().describe("地域定向"),
    schedule: z.string().optional().describe("投放时段"),
  },
  async ({ account, campaign_name, budget, region, schedule }) => {
    const campaign = { campaignName: campaign_name, budget };
    if (region) campaign.region = region;
    if (schedule) campaign.schedule = schedule;
    const result = await call360Api("/search/campaign/addCampaign", campaign, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "update_campaign",
  "更新搜索推广计划（名称、预算、状态等）",
  {
    account: z.string().optional().describe("账户标签"),
    campaign_id: z.number().describe("计划 ID"),
    campaign_name: z.string().optional().describe("新名称"),
    budget: z.number().optional().describe("新日预算（元）"),
    status: z.string().optional().describe("状态: enable/pause"),
  },
  async ({ account, campaign_id, campaign_name, budget, status }) => {
    const data = { campaignId: campaign_id };
    if (campaign_name) data.campaignName = campaign_name;
    if (budget !== undefined) data.budget = budget;
    if (status) data.status = status;
    const result = await call360Api("/search/campaign/updateCampaign", data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "delete_campaign",
  "删除搜索推广计划（不可恢复）",
  {
    account: z.string().optional().describe("账户标签"),
    campaign_ids: z.array(z.number()).describe("要删除的计划 ID 列表"),
  },
  async ({ account, campaign_ids }) => {
    const result = await call360Api("/search/campaign/deleteCampaign", { campaignIds: campaign_ids }, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Ad Group Tools ----

server.tool(
  "list_groups",
  "获取推广组列表",
  {
    account: z.string().optional().describe("账户标签"),
    campaign_id: z.number().optional().describe("按计划 ID 筛选"),
    group_ids: z.array(z.number()).optional().describe("指定推广组 ID 列表"),
  },
  async ({ account, campaign_id, group_ids }) => {
    const data = {};
    if (group_ids?.length) data.groupIds = group_ids;
    if (campaign_id) data.campaignId = campaign_id;
    const result = await call360Api("/search/group/getGroup", data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "create_group",
  "创建推广组",
  {
    account: z.string().optional().describe("账户标签"),
    campaign_id: z.number().describe("所属计划 ID"),
    group_name: z.string().describe("推广组名称"),
    price: z.number().describe("默认出价（元）"),
  },
  async ({ account, campaign_id, group_name, price }) => {
    const result = await call360Api("/search/group/addGroup", {
      campaignId: campaign_id, groupName: group_name, price,
    }, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "update_group",
  "更新推广组（名称、出价、状态等）",
  {
    account: z.string().optional().describe("账户标签"),
    group_id: z.number().describe("推广组 ID"),
    group_name: z.string().optional().describe("新名称"),
    price: z.number().optional().describe("新出价（元）"),
    status: z.string().optional().describe("状态: enable/pause"),
  },
  async ({ account, group_id, group_name, price, status }) => {
    const data = { groupId: group_id };
    if (group_name) data.groupName = group_name;
    if (price !== undefined) data.price = price;
    if (status) data.status = status;
    const result = await call360Api("/search/group/updateGroup", data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Keyword Tools ----

server.tool(
  "list_keywords",
  "获取关键词列表",
  {
    account: z.string().optional().describe("账户标签"),
    group_id: z.number().optional().describe("按推广组 ID 筛选"),
    keyword_ids: z.array(z.number()).optional().describe("指定关键词 ID 列表"),
  },
  async ({ account, group_id, keyword_ids }) => {
    const data = {};
    if (keyword_ids?.length) data.keywordIds = keyword_ids;
    if (group_id) data.groupId = group_id;
    const path = group_id ? "/search/keyword/getKeywordByGroupId" : "/search/keyword/getKeyword";
    const result = await call360Api(path, data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "add_keywords",
  "批量添加关键词",
  {
    account: z.string().optional().describe("账户标签"),
    keywords: z.array(z.object({
      group_id: z.number().describe("所属推广组 ID"),
      keyword: z.string().describe("关键词文本"),
      price: z.number().describe("出价（元）"),
      match_type: z.number().default(1).describe("匹配类型: 1=精确, 2=短语, 3=广泛"),
      destination_url: z.string().optional().describe("落地页 URL"),
    })).describe("关键词列表"),
  },
  async ({ account, keywords }) => {
    const items = keywords.map((kw) => {
      const item = {
        groupId: kw.group_id,
        keyword: kw.keyword,
        price: kw.price,
        matchType: kw.match_type,
      };
      if (kw.destination_url) item.destinationUrl = kw.destination_url;
      return item;
    });
    const result = await call360Api("/search/keyword/addKeyword", { keywords: items }, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "update_keywords",
  "批量更新关键词（出价、匹配类型、落地页等）",
  {
    account: z.string().optional().describe("账户标签"),
    keywords: z.array(z.object({
      keyword_id: z.number().describe("关键词 ID"),
      price: z.number().optional().describe("新出价（元）"),
      match_type: z.number().optional().describe("匹配类型"),
      destination_url: z.string().optional().describe("落地页 URL"),
      status: z.string().optional().describe("状态: enable/pause"),
    })).describe("关键词更新列表"),
  },
  async ({ account, keywords }) => {
    const items = keywords.map((kw) => {
      const item = { keywordId: kw.keyword_id };
      if (kw.price !== undefined) item.price = kw.price;
      if (kw.match_type !== undefined) item.matchType = kw.match_type;
      if (kw.destination_url) item.destinationUrl = kw.destination_url;
      if (kw.status) item.status = kw.status;
      return item;
    });
    const result = await call360Api("/search/keyword/updateKeyword", { keywords: items }, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "delete_keywords",
  "批量删除关键词",
  {
    account: z.string().optional().describe("账户标签"),
    keyword_ids: z.array(z.number()).describe("要删除的关键词 ID 列表"),
  },
  async ({ account, keyword_ids }) => {
    const result = await call360Api("/search/keyword/deleteKeyword", { keywordIds: keyword_ids }, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Creative Tools ----

server.tool(
  "list_creatives",
  "获取创意列表",
  {
    account: z.string().optional().describe("账户标签"),
    group_id: z.number().optional().describe("按推广组 ID 筛选"),
  },
  async ({ account, group_id }) => {
    const data = group_id ? { groupId: group_id } : {};
    const result = await call360Api("/search/creative/getCreative", data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "create_creative",
  "创建搜索推广创意",
  {
    account: z.string().optional().describe("账户标签"),
    group_id: z.number().describe("所属推广组 ID"),
    title: z.string().describe("创意标题"),
    description1: z.string().describe("描述行1"),
    description2: z.string().optional().describe("描述行2"),
    destination_url: z.string().describe("落地页 URL"),
    display_url: z.string().optional().describe("显示 URL"),
  },
  async ({ account, group_id, title, description1, description2, destination_url, display_url }) => {
    const creative = { groupId: group_id, title, description1, destinationUrl: destination_url };
    if (description2) creative.description2 = description2;
    if (display_url) creative.displayUrl = display_url;
    const result = await call360Api("/search/creative/addCreative", creative, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Report Tools ----

server.tool(
  "get_report",
  "获取投放效果报告（支持账户/计划/推广组/关键词/创意级别）",
  {
    account: z.string().optional().describe("账户标签"),
    report_type: z.enum(["account", "campaign", "group", "keyword", "creative"]).describe("报告级别"),
    start_date: z.string().describe("开始日期（格式: YYYY-MM-DD）"),
    end_date: z.string().describe("结束日期（格式: YYYY-MM-DD）"),
    campaign_id: z.number().optional().describe("按计划 ID 筛选（非账户级报告时可用）"),
  },
  async ({ account, report_type, start_date, end_date, campaign_id }) => {
    const pathMap = {
      account: "/dianjing/report/accountDaily",
      campaign: "/dianjing/report/campaign",
      group: "/dianjing/report/group",
      keyword: "/dianjing/report/keyword",
      creative: "/dianjing/report/creative",
    };
    const data = { startDate: start_date, endDate: end_date };
    if (campaign_id) data.campaignId = campaign_id;
    const result = await call360Api(pathMap[report_type], data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_ocpc_report",
  "获取 OCPC/OCPX 转化报表（含转化数、转化成本、投放包信息）。注意：只能查到昨天及之前的结算数据",
  {
    account: z.string().optional().describe("账户标签"),
    start_date: z.string().describe("开始日期（格式: YYYY-MM-DD，最晚到昨天）"),
    end_date: z.string().describe("结束日期（格式: YYYY-MM-DD，最晚到昨天，跨度最大90天）"),
    type: z.string().optional().describe("流量范围: all/mobile/computer，默认all"),
    page: z.number().optional().describe("页码，默认1，每页最多1000条"),
  },
  async ({ account, start_date, end_date, type, page }) => {
    const data = { startDate: start_date, endDate: end_date };
    if (type) data.type = type;
    if (page) data.page = String(page);
    const result = await call360Api("/dianjing/report/Ocpc", data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_creative_report",
  "获取搜索推广创意级效果报表（含创意标题+展点消）",
  {
    account: z.string().optional().describe("账户标签（如 my-account-1）"),
    start_date: z.string().describe("开始日期（格式: YYYY-MM-DD）"),
    end_date: z.string().describe("结束日期（格式: YYYY-MM-DD）"),
  },
  async ({ account, start_date, end_date }) => {
    const data = { startDate: start_date, endDate: end_date };
    const result = await call360Api("/dianjing/report/creative", data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_display_report",
  "获取 360 展示广告（信息流/屏保/弹窗等）消耗报表，按素材粒度返回。字段含：campaignName, groupName, creativeName, totalCost, clicks, views, materialUrls",
  {
    account: z.string().optional().describe("账户标签（如 my-display-account）"),
    start_date: z.string().describe("开始日期（格式: YYYY-MM-DD）"),
    end_date: z.string().describe("结束日期（格式: YYYY-MM-DD）"),
  },
  async ({ account, start_date, end_date }) => {
    const data = { startDate: start_date, endDate: end_date };
    const result = await call360Api("/display/report/cost", data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_display_creatives",
  "获取360展示广告创意素材明细（含素材图片URL、消耗、点击等）",
  {
    account: z.string().optional().describe("账户标签（如 my-display-account）"),
    start_date: z.string().describe("开始日期（格式: YYYY-MM-DD）"),
    end_date: z.string().describe("结束日期（格式: YYYY-MM-DD）"),
  },
  async ({ account, start_date, end_date }) => {
    const data = { startDate: start_date, endDate: end_date };
    const result = await call360Api("/display/report/cost", data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_display_conversions",
  "获取 360 展示广告转化明细数据（含转化时间、计划、创意、地域等）",
  {
    account: z.string().optional().describe("账户标签（如 my-display-account）"),
    start_date: z.string().describe("开始日期（格式: YYYY-MM-DD）"),
    end_date: z.string().describe("结束日期（格式: YYYY-MM-DD）"),
  },
  async ({ account, start_date, end_date }) => {
    const data = { startDate: start_date, endDate: end_date };
    const result = await call360Api("/display/report/adtransform", data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_realtime_data",
  "获取实时投放数据",
  { account: z.string().optional().describe("账户标签") },
  async ({ account }) => {
    const result = await call360Api("/report/getRealTimeData", {}, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Negative Keyword Tools ----

server.tool(
  "list_negatives",
  "获取否定关键词列表",
  {
    account: z.string().optional().describe("账户标签"),
    campaign_id: z.number().optional().describe("按计划 ID 筛选"),
    group_id: z.number().optional().describe("按推广组 ID 筛选"),
  },
  async ({ account, campaign_id, group_id }) => {
    const data = {};
    if (campaign_id) data.campaignId = campaign_id;
    if (group_id) data.groupId = group_id;
    const result = await call360Api("/search/negative/getNegative", data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "add_negatives",
  "添加否定关键词",
  {
    account: z.string().optional().describe("账户标签"),
    campaign_id: z.number().optional().describe("计划 ID（计划级否定）"),
    group_id: z.number().optional().describe("推广组 ID（推广组级否定）"),
    negatives: z.array(z.string()).describe("否定关键词列表"),
    exact: z.boolean().default(false).describe("是否精确否定"),
  },
  async ({ account, campaign_id, group_id, negatives, exact }) => {
    const data = { negatives, exact };
    if (campaign_id) data.campaignId = campaign_id;
    if (group_id) data.groupId = group_id;
    const result = await call360Api("/search/negative/addNegative", data, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Keyword Tool ----

server.tool(
  "keyword_recommend",
  "关键词推荐工具",
  {
    account: z.string().optional().describe("账户标签"),
    seed_words: z.array(z.string()).describe("种子关键词列表"),
  },
  async ({ account, seed_words }) => {
    const result = await call360Api("/tool/getKeywordRecommend", { keywords: seed_words }, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "keyword_estimate",
  "关键词出价/排名估算",
  {
    account: z.string().optional().describe("账户标签"),
    keywords: z.array(z.object({
      keyword: z.string().describe("关键词"),
      price: z.number().describe("出价（元）"),
    })).describe("关键词及出价列表"),
  },
  async ({ account, keywords }) => {
    const result = await call360Api("/tool/getKeywordEstimate", { keywords }, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Custom API Call ----

server.tool(
  "custom_api_call",
  "自定义调用 360 点睛 API（高级用户，直接指定接口路径和参数）",
  {
    account: z.string().optional().describe("账户标签"),
    path: z.string().describe("API 路径（如 /search/campaign/getCampaign）"),
    data: z.record(z.any()).default({}).describe("请求参数 JSON"),
  },
  async ({ account, path, data }) => {
    const result = await call360Api(path, Object.keys(data).length ? data : null, account);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ============================================================
// Start server
// ============================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch(console.error);
