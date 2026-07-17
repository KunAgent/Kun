#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import https from "https";
import http from "http";
import { URL } from "url";
import fs from "fs";
import path from "path";

// ============================================================
// 百度营销 MCP Server
// 基于百度营销 API (OAuth 2.0) 封装
// ============================================================

const CONFIG_PATH = process.env.BAIDU_ADS_CONFIG_PATH || "";
const APP_ID = process.env.BAIDU_ADS_APP_ID || "";
const SECRET_KEY = process.env.BAIDU_ADS_SECRET_KEY || "";
const CALLBACK_URL = process.env.BAIDU_ADS_CALLBACK_URL || "http://localhost:8080/oauth/callback";

// Token storage (in-memory, updated via tools)
let currentToken = {
  accessToken: process.env.BAIDU_ADS_ACCESS_TOKEN || "",
  refreshToken: process.env.BAIDU_ADS_REFRESH_TOKEN || "",
  userName: process.env.BAIDU_ADS_USERNAME || "",
  userId: process.env.BAIDU_ADS_USER_ID || "",
};

// API endpoints
const API = {
  SEARCH: "https://api.baidu.com/json/sms/service",
  FEED: "https://api.baidu.com/json/feed/v1",
  OAUTH_TOKEN: "https://u.baidu.com/oauth/accessToken",
  OAUTH_REFRESH: "https://u.baidu.com/oauth/refreshToken",
  OAUTH_AUTHORIZE: "https://u.baidu.com/oauth/authorize",
  OAUTH_USERINFO: "https://u.baidu.com/oauth/getUserInfo",
};

// ---- HTTP helper ----
function httpRequest(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const body = JSON.stringify(data);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...headers,
      },
    };
    const req = mod.request(opts, (res) => {
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

// ---- Baidu Ads API caller ----
async function callBaiduApi(baseUrl, service, method, body = {}) {
  if (!currentToken.accessToken) {
    return { error: "未配置 accessToken，请先运行 oauth_get_auth_url 和 oauth_exchange_code 完成授权" };
  }
  const url = `${baseUrl}/${service}/${method}`;
  const payload = {
    header: {
      userName: currentToken.userName,
      accessToken: currentToken.accessToken,
    },
    body,
  };
  const result = await httpRequest(url, payload);
  // Auto-refresh on token expiry
  if (result?.header?.status === 1 && currentToken.refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed.accessToken) {
      payload.header.accessToken = refreshed.accessToken;
      return httpRequest(url, payload);
    }
  }
  return result;
}

async function callSearchApi(service, method, body = {}) {
  return callBaiduApi(API.SEARCH, service, method, body);
}

async function callFeedApi(service, method, body = {}) {
  return callBaiduApi(API.FEED, service, method, body);
}

async function refreshAccessToken() {
  if (!currentToken.refreshToken) return { error: "无 refreshToken" };
  const resp = await httpRequest(API.OAUTH_REFRESH, {
    appId: APP_ID,
    secretKey: SECRET_KEY,
    refreshToken: currentToken.refreshToken,
  });
  if (resp?.data?.accessToken) {
    currentToken.accessToken = resp.data.accessToken;
    if (resp.data.refreshToken) currentToken.refreshToken = resp.data.refreshToken;
    // Save to config if path exists
    saveTokenToConfig();
  }
  return resp?.data || resp;
}

function saveTokenToConfig() {
  if (!CONFIG_PATH) return;
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (cfg.accounts && cfg.accounts.length > 0) {
      cfg.accounts[0].access_token = currentToken.accessToken;
      cfg.accounts[0].refresh_token = currentToken.refreshToken;
      cfg.accounts[0].token_expires_at = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    }
  } catch { /* ignore */ }
}

// ============================================================
// MCP Server Setup
// ============================================================

const server = new McpServer({
  name: "baidu-ads",
  version: "1.0.0",
});

// ---- OAuth Tools ----

server.tool(
  "oauth_get_auth_url",
  "生成百度营销 OAuth 授权链接，用户需在浏览器中打开并完成授权",
  { scope: z.string().optional().describe("权限范围，默认留空表示不限") },
  async ({ scope }) => {
    const params = new URLSearchParams({
      appid: APP_ID,
      redirect_uri: CALLBACK_URL,
      response_type: "code",
    });
    if (scope) params.set("scope", scope);
    const url = `${API.OAUTH_AUTHORIZE}?${params.toString()}`;
    return {
      content: [
        {
          type: "text",
          text: `🔗 百度营销授权链接:\n\n${url}\n\n请在浏览器中打开此链接，登录百度推广账号并授权。\n授权后浏览器会跳转到回调地址，从地址栏复制 authCode 参数值，然后调用 oauth_exchange_code 工具。`,
        },
      ],
    };
  }
);

server.tool(
  "oauth_exchange_code",
  "使用授权码(authCode)换取 accessToken 和 refreshToken",
  {
    auth_code: z.string().describe("OAuth 授权码"),
    user_id: z.number().describe("百度推广账户的 userId"),
  },
  async ({ auth_code, user_id }) => {
    const resp = await httpRequest(API.OAUTH_TOKEN, {
      appId: APP_ID,
      secretKey: SECRET_KEY,
      grantType: "authorization_code",
      authCode: auth_code,
      userId: user_id,
    });
    if (resp?.data?.accessToken) {
      currentToken.accessToken = resp.data.accessToken;
      currentToken.refreshToken = resp.data.refreshToken || "";
      currentToken.userName = resp.data.userName || "";
      currentToken.userId = String(user_id);
      saveTokenToConfig();
      return {
        content: [
          {
            type: "text",
            text: `✅ 授权成功！\n\n用户名: ${resp.data.userName || "N/A"}\nuserId: ${user_id}\naccessToken: ${resp.data.accessToken.substring(0, 30)}...\nrefreshToken: ${(resp.data.refreshToken || "").substring(0, 30)}...\n\nToken 已自动保存，现在可以使用所有广告管理工具了。`,
          },
        ],
      };
    }
    return { content: [{ type: "text", text: `❌ 授权失败:\n${JSON.stringify(resp, null, 2)}` }] };
  }
);

server.tool(
  "oauth_refresh_token",
  "刷新 accessToken（当 token 过期时使用）",
  {},
  async () => {
    const result = await refreshAccessToken();
    if (result.accessToken) {
      return {
        content: [{ type: "text", text: `✅ Token 刷新成功！\naccessToken: ${result.accessToken.substring(0, 30)}...` }],
      };
    }
    return { content: [{ type: "text", text: `❌ 刷新失败:\n${JSON.stringify(result, null, 2)}` }] };
  }
);

// ---- Account Tools ----

server.tool(
  "get_account_info",
  "获取百度推广账户信息（余额、状态、日预算等）",
  { type: z.enum(["search", "feed"]).optional().describe("账户类型: search=搜索推广, feed=信息流") },
  async ({ type }) => {
    let result;
    if (type === "feed") {
      result = await callFeedApi("AccountFeedService", "getAccountFeed", {});
    } else {
      result = await callSearchApi("AccountService", "getAccountInfo", {
        accountFields: [
          "userId", "balance", "cost", "budget", "budgetType",
          "regionTarget", "userStat", "isDynamicCreative",
        ],
      });
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Campaign Tools ----

server.tool(
  "list_campaigns",
  "获取搜索推广计划列表",
  {
    campaign_ids: z.array(z.number()).optional().describe("指定计划ID列表，不传则获取所有"),
    fields: z.array(z.string()).optional().describe("返回字段，默认全部"),
  },
  async ({ campaign_ids, fields }) => {
    const body = {};
    if (campaign_ids?.length) body.campaignIds = campaign_ids;
    body.campaignFields = fields || [
      "campaignId", "campaignName", "budget", "regionTarget",
      "status", "campaignType", "schedule", "device",
    ];
    const result = await callSearchApi("CampaignService", "getCampaign", body);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "create_campaign",
  "创建搜索推广计划",
  {
    campaign_name: z.string().describe("计划名称"),
    budget: z.number().describe("日预算（元，如 500 表示 500 元/天）"),
    region_target: z.string().optional().describe("地域定向，如 '北京,上海'"),
  },
  async ({ campaign_name, budget, region_target }) => {
    const campaignType = [{ campaignName: campaign_name, budget: budget * 100 }];
    if (region_target) campaignType[0].regionTarget = region_target;
    const result = await callSearchApi("CampaignService", "addCampaign", {
      campaignTypes: campaignType,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "update_campaign",
  "更新搜索推广计划（名称、预算、状态等）",
  {
    campaign_id: z.number().describe("计划ID"),
    campaign_name: z.string().optional().describe("新的计划名称"),
    budget: z.number().optional().describe("新的日预算（元）"),
    pause: z.boolean().optional().describe("是否暂停: true=暂停, false=启用"),
  },
  async ({ campaign_id, campaign_name, budget, pause }) => {
    const update = { campaignId: campaign_id };
    if (campaign_name) update.campaignName = campaign_name;
    if (budget !== undefined) update.budget = budget * 100;
    if (pause !== undefined) update.pause = pause;
    const result = await callSearchApi("CampaignService", "updateCampaign", {
      campaignTypes: [update],
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "delete_campaign",
  "删除搜索推广计划（不可恢复）",
  { campaign_ids: z.array(z.number()).describe("要删除的计划ID列表") },
  async ({ campaign_ids }) => {
    const result = await callSearchApi("CampaignService", "deleteCampaign", {
      campaignIds: campaign_ids,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Ad Group Tools ----

server.tool(
  "list_adgroups",
  "获取推广单元列表",
  {
    campaign_id: z.number().optional().describe("按计划ID筛选"),
    adgroup_ids: z.array(z.number()).optional().describe("指定单元ID列表"),
  },
  async ({ campaign_id, adgroup_ids }) => {
    const body = {
      adgroupFields: [
        "adgroupId", "campaignId", "adgroupName", "maxPrice",
        "status", "pause", "negativeWords", "exactNegativeWords",
      ],
    };
    if (adgroup_ids?.length) {
      body.adgroupIds = adgroup_ids;
      body.idType = 7;
    } else if (campaign_id) {
      body.campaignIds = [campaign_id];
      body.idType = 3;
    }
    const result = await callSearchApi("AdgroupService", "getAdgroup", body);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "create_adgroup",
  "创建推广单元",
  {
    campaign_id: z.number().describe("所属计划ID"),
    adgroup_name: z.string().describe("单元名称"),
    max_price: z.number().describe("最高出价（元）"),
  },
  async ({ campaign_id, adgroup_name, max_price }) => {
    const result = await callSearchApi("AdgroupService", "addAdgroup", {
      adgroupTypes: [{
        campaignId: campaign_id,
        adgroupName: adgroup_name,
        maxPrice: max_price * 100,
      }],
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "update_adgroup",
  "更新推广单元（名称、出价、暂停等）",
  {
    adgroup_id: z.number().describe("单元ID"),
    adgroup_name: z.string().optional().describe("新名称"),
    max_price: z.number().optional().describe("新出价（元）"),
    pause: z.boolean().optional().describe("是否暂停"),
  },
  async ({ adgroup_id, adgroup_name, max_price, pause }) => {
    const update = { adgroupId: adgroup_id };
    if (adgroup_name) update.adgroupName = adgroup_name;
    if (max_price !== undefined) update.maxPrice = max_price * 100;
    if (pause !== undefined) update.pause = pause;
    const result = await callSearchApi("AdgroupService", "updateAdgroup", {
      adgroupTypes: [update],
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Keyword Tools ----

server.tool(
  "list_keywords",
  "获取关键词列表",
  {
    adgroup_id: z.number().optional().describe("按单元ID筛选"),
    campaign_id: z.number().optional().describe("按计划ID筛选"),
    keyword_ids: z.array(z.number()).optional().describe("指定关键词ID列表"),
  },
  async ({ adgroup_id, campaign_id, keyword_ids }) => {
    const body = {
      wordFields: [
        "keywordId", "adgroupId", "keyword", "price", "matchType",
        "status", "pause", "pcDestinationUrl", "mobileDestinationUrl",
      ],
    };
    if (keyword_ids?.length) {
      body.ids = keyword_ids;
      body.idType = 11;
    } else if (adgroup_id) {
      body.ids = [adgroup_id];
      body.idType = 5;
    } else if (campaign_id) {
      body.ids = [campaign_id];
      body.idType = 3;
    }
    const result = await callSearchApi("KeywordService", "getWord", body);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "add_keywords",
  "批量添加关键词",
  {
    keywords: z.array(z.object({
      adgroup_id: z.number().describe("所属单元ID"),
      keyword: z.string().describe("关键词文本"),
      price: z.number().describe("出价（元）"),
      match_type: z.number().optional().describe("匹配类型(默认1): 1=精确, 2=短语, 3=广泛"),
      pc_url: z.string().optional().describe("PC端落地页URL"),
      mobile_url: z.string().optional().describe("移动端落地页URL"),
    })).describe("关键词列表"),
  },
  async ({ keywords }) => {
    const wordTypes = keywords.map((kw) => {
      const w = {
        adgroupId: kw.adgroup_id,
        keyword: kw.keyword,
        price: kw.price * 100,
        matchType: kw.match_type || 1,
      };
      if (kw.pc_url) w.pcDestinationUrl = kw.pc_url;
      if (kw.mobile_url) w.mobileDestinationUrl = kw.mobile_url;
      return w;
    });
    const result = await callSearchApi("KeywordService", "addWord", { wordTypes });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "update_keywords",
  "批量更新关键词（出价、匹配类型、落地页等）",
  {
    keywords: z.array(z.object({
      keyword_id: z.number().describe("关键词ID"),
      price: z.number().optional().describe("新出价（元）"),
      match_type: z.number().optional().describe("匹配类型: 1=精确, 2=短语, 3=广泛"),
      pause: z.boolean().optional().describe("是否暂停"),
      pc_url: z.string().optional().describe("PC端落地页URL"),
      mobile_url: z.string().optional().describe("移动端落地页URL"),
    })).describe("关键词更新列表"),
  },
  async ({ keywords }) => {
    const wordTypes = keywords.map((kw) => {
      const w = { keywordId: kw.keyword_id };
      if (kw.price !== undefined) w.price = kw.price * 100;
      if (kw.match_type !== undefined) w.matchType = kw.match_type;
      if (kw.pause !== undefined) w.pause = kw.pause;
      if (kw.pc_url) w.pcDestinationUrl = kw.pc_url;
      if (kw.mobile_url) w.mobileDestinationUrl = kw.mobile_url;
      return w;
    });
    const result = await callSearchApi("KeywordService", "updateWord", { wordTypes });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "delete_keywords",
  "批量删除关键词",
  { keyword_ids: z.array(z.number()).describe("要删除的关键词ID列表") },
  async ({ keyword_ids }) => {
    const result = await callSearchApi("KeywordService", "deleteWord", {
      keywordIds: keyword_ids,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Creative Tools ----

server.tool(
  "list_creatives",
  "获取创意列表",
  {
    adgroup_id: z.number().optional().describe("按单元ID筛选"),
    campaign_id: z.number().optional().describe("按计划ID筛选"),
  },
  async ({ adgroup_id, campaign_id }) => {
    const body = {
      creativeFields: [
        "creativeId", "adgroupId", "title", "description1",
        "description2", "status", "pause", "pcDestinationUrl", "mobileDestinationUrl",
      ],
    };
    if (adgroup_id) {
      body.ids = [adgroup_id];
      body.idType = 5;
    } else if (campaign_id) {
      body.ids = [campaign_id];
      body.idType = 3;
    }
    const result = await callSearchApi("CreativeService", "getCreative", body);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "create_creative",
  "创建搜索推广创意",
  {
    adgroup_id: z.number().describe("所属单元ID"),
    title: z.string().describe("创意标题（最多50字符，可含{关键词}通配符）"),
    description1: z.string().describe("描述行1（最多80字符）"),
    description2: z.string().optional().describe("描述行2（最多80字符）"),
    pc_url: z.string().describe("PC端落地页URL"),
    mobile_url: z.string().optional().describe("移动端落地页URL"),
  },
  async ({ adgroup_id, title, description1, description2, pc_url, mobile_url }) => {
    const creative = {
      adgroupId: adgroup_id,
      title,
      description1,
      pcDestinationUrl: pc_url,
    };
    if (description2) creative.description2 = description2;
    if (mobile_url) creative.mobileDestinationUrl = mobile_url;
    const result = await callSearchApi("CreativeService", "addCreative", {
      creativeTypes: [creative],
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Report Tools ----

server.tool(
  "get_report",
  "获取广告效果报告数据（支持账户/计划/单元/关键词/创意级别）",
  {
    report_type: z.number().describe("报告类型ID（如 2602781=账户报告, 2602782=计划报告, 2602783=关键词报告）"),
    start_date: z.string().describe("开始日期（格式: YYYY-MM-DD）"),
    end_date: z.string().describe("结束日期（格式: YYYY-MM-DD）"),
    fields: z.array(z.string()).optional().describe("返回字段列表"),
    filters: z.string().optional().describe("筛选条件"),
    page: z.number().optional().describe("页码，默认1"),
    page_size: z.number().optional().describe("每页条数，默认100"),
  },
  async ({ report_type, start_date, end_date, fields, filters, page, page_size }) => {
    const body = {
      reportType: report_type,
      startDate: start_date.replace(/-/g, ""),
      endDate: end_date.replace(/-/g, ""),
      page: page || 1,
      pageSize: page_size || 100,
    };
    if (fields?.length) body.fields = fields;
    if (filters) body.filters = JSON.parse(filters);
    const result = await callSearchApi("OpenApiReportService", "getReportData", body);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_realtime_report",
  "获取搜索推广实时报表（展点消+转化全指标）。支持账户/计划/单元/关键词/创意级别。转化字段含应用注册(ocpcConversionsDetail25)和表单提交(ocpcConversionsDetail3)",
  {
    account: z.string().optional().describe("账户标签（如 my-account-1），不传则用默认账户"),
    start_date: z.string().describe("开始日期（格式: YYYY-MM-DD）"),
    end_date: z.string().describe("结束日期（格式: YYYY-MM-DD）"),
    level: z.enum(["account","plan","unit","keyword","creative"]).optional().describe("报表粒度: account=账户, plan=计划, unit=单元, keyword=关键词, creative=创意。默认account"),
    fields: z.array(z.string()).optional().describe("自定义指标字段（默认含展点消+转化），可选: impression,click,cost,cpc,cpm,ctr,conversion,ocpcConversionsDetail25,ocpcConversionsDetail3 等"),
  },
  async ({ account, start_date, end_date, level, fields }) => {
    const levelMap = { account: 2, plan: 3, unit: 5, keyword: 11, creative: 7 };
    const reportTypeMap = { account: 2, plan: 5, unit: 6, keyword: 14, creative: 14 };
    const lv = level || "account";
    const performanceData = fields || ["impression","click","cost","cpc","cpm","ocpcConversionsDetail25","ocpcConversionsDetail3"];

    // 确定使用哪个账户
    const accounts = JSON.parse(await import("fs").then(f => f.default.readFileSync(new URL("./accounts.json", import.meta.url), "utf8"))).accounts;
    const targetAccounts = account ? accounts.filter(a => a.name === account || a.label === account) : accounts.filter(a => a.accessToken);

    const results = [];
    for (const acc of targetAccounts) {
      if (!acc.accessToken) continue;
      try {
        const resp = await fetch("https://api.baidu.com/json/sms/service/ReportService/getRealTimeData", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            header: { accessToken: acc.accessToken, userName: acc.name },
            body: { realTimeRequestType: {
              performanceData,
              startDate: start_date, endDate: end_date,
              unitOfTime: 5, statRange: 2,
              reportType: reportTypeMap[lv],
              levelOfDetails: levelMap[lv]
            }}
          })
        });
        const data = await resp.json();
        if (data?.body?.data?.length > 0) {
          results.push({ account: acc.name, data: data.body.data, fields: performanceData });
        } else {
          results.push({ account: acc.name, error: data?.header?.failures?.[0]?.message || "no data" });
        }
      } catch (e) {
        results.push({ account: acc.name, error: e.message });
      }
    }
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  "get_creative_report",
  "获取搜索推广创意级效果报表（含标题/描述+展点消+转化）。返回每条创意的标题、描述、展现、点击、消费、转化数据",
  {
    account: z.string().optional().describe("账户标签（如 my-account-1），不传则查所有账户"),
    start_date: z.string().describe("开始日期（格式: YYYY-MM-DD）"),
    end_date: z.string().describe("结束日期（格式: YYYY-MM-DD）"),
    fields: z.array(z.string()).optional().describe("自定义指标字段（默认含展点消+转化）"),
  },
  async ({ account, start_date, end_date, fields }) => {
    const performanceData = fields || ["impression","click","cost","cpc","cpm","ocpcConversionsDetail25","ocpcConversionsDetail3"];
    
    // 读取accounts.json获取账户列表（复用get_realtime_report的逻辑）
    const accounts = JSON.parse(await import("fs").then(f => f.default.readFileSync(new URL("./accounts.json", import.meta.url), "utf8"))).accounts;
    const targetAccounts = account ? accounts.filter(a => a.name === account || a.label === account) : accounts.filter(a => a.accessToken);

    const results = [];
    for (const acc of targetAccounts) {
      if (!acc.accessToken) continue;
      try {
        const resp = await fetch("https://api.baidu.com/json/sms/service/ReportService/getRealTimeData", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            header: { accessToken: acc.accessToken, userName: acc.name },
            body: { realTimeRequestType: {
              performanceData,
              startDate: start_date, endDate: end_date,
              unitOfTime: 5, statRange: 2,
              reportType: 12, levelOfDetails: 7
            }}
          })
        });
        const data = await resp.json();
        if (data?.body?.data?.length > 0) {
          // 聚合去掉地域维度：按 name[0]+name[1]+name[2]+name[3] 聚合
          const creativeMap = {};
          for (const d of data.body.data) {
            const key = (d.name || []).slice(0, 6).join("||");
            if (!creativeMap[key]) {
              creativeMap[key] = {
                account: d.name?.[0] || "",
                campaign: d.name?.[1] || "",
                adgroup: d.name?.[2] || "",
                title: d.name?.[3] || "",
                desc1: d.name?.[4] || "",
                desc2: d.name?.[5] || "",
                kpis: performanceData.map(() => 0),
              };
            }
            for (let i = 0; i < performanceData.length; i++) {
              creativeMap[key].kpis[i] += parseFloat(d.kpis?.[i] || 0);
            }
          }
          const creatives = Object.values(creativeMap).sort((a, b) => b.kpis[2] - a.kpis[2]); // 按消费降序
          results.push({ account: acc.name, creatives, fields: performanceData });
        } else {
          results.push({ account: acc.name, error: data?.header?.failures?.[0]?.message || "no data" });
        }
      } catch (e) {
        results.push({ account: acc.name, error: e.message });
      }
    }
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// ---- Feed (信息流) Campaign Tools ----

server.tool(
  "list_feed_campaigns",
  "获取信息流推广计划列表",
  {
    campaign_ids: z.array(z.number()).optional().describe("指定计划ID列表"),
  },
  async ({ campaign_ids }) => {
    const body = {
      campaignFeedFields: [
        "campaignFeedId", "campaignFeedName", "budget",
        "status", "campaignFeedType", "startTime", "endTime",
      ],
    };
    if (campaign_ids?.length) body.campaignFeedIds = campaign_ids;
    const result = await callFeedApi("CampaignFeedService", "getCampaignFeed", body);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Keyword Planner Tools ----

server.tool(
  "keyword_ideas",
  "关键词推荐（使用百度关键词规划师 KR 服务获取搜索量、竞争度等）",
  {
    keywords: z.array(z.string()).describe("种子关键词列表（最多10个）"),
  },
  async ({ keywords }) => {
    const result = await callSearchApi("KRService", "getKRByQuery", {
      queryList: keywords.map((kw) => ({ query: kw })),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Balance Tool ----

server.tool(
  "get_balance",
  "获取账户余额信息",
  {},
  async () => {
    const result = await callSearchApi("BalanceService", "getBalanceInfo", {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Custom API Call ----

server.tool(
  "custom_api_call",
  "自定义调用百度营销 API（高级用户使用，直接指定服务名和方法名）",
  {
    api_type: z.enum(["search", "feed"]).describe("API类型: search=搜索推广, feed=信息流"),
    service: z.string().describe("服务名（如 CampaignService, KeywordService）"),
    method: z.string().describe("方法名（如 getCampaign, addWord）"),
    body: z.string().optional().describe("请求体 JSON 字符串"),
  },
  async ({ api_type, service, method, body }) => {
    const parsedBody = body ? JSON.parse(body) : {};
    const result = api_type === "feed"
      ? await callFeedApi(service, method, parsedBody)
      : await callSearchApi(service, method, parsedBody);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ============================================================
// Start server
// ============================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("百度营销 MCP Server running on stdio");
}

main().catch(console.error);
