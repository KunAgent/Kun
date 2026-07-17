#!/usr/bin/env node
/**
 * 百度营销多账户 Token 刷新脚本
 * 读取 accounts.json，为每个账户调用 https://u.baidu.com/oauth/refreshToken 获取新 token
 */

import https from "https";
import http from "http";
import { URL } from "url";
import fs from "fs";
import path from "path";

const ACCOUNTS_PATH = "/Users/yangjiayi/.workbuddy/mcp-servers/baidu-ads-mcp/accounts.json";
const REFRESH_URL = "https://u.baidu.com/oauth/refreshToken";

// ---- HTTP helper ----
function httpRequest(url, data) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const body = JSON.stringify(data);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
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

// ---- Main ----
async function main() {
  const config = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf8"));

  // 建立 appId -> secretKey 映射
  const secretKeyMap = {};
  for (const [key, app] of Object.entries(config.apps || {})) {
    secretKeyMap[app.appId] = app.secretKey;
  }

  const results = [];
  let hasFailure = false;

  for (const account of config.accounts) {
    const appId = account.appId;
    const secretKey = secretKeyMap[appId];
    if (!secretKey) {
      results.push({
        name: account.name,
        userId: account.userId,
        status: "❌ 失败",
        reason: `appId=${appId} 在 apps 中找不到对应的 secretKey`,
        newAccessToken: null,
        newRefreshToken: null,
        newExpiresTime: null,
        refreshTokenExpired: false,
      });
      hasFailure = true;
      continue;
    }

    try {
      const resp = await httpRequest(REFRESH_URL, {
        appId: appId,
        secretKey: secretKey,
        refreshToken: account.refreshToken,
        userId: String(account.userId), // 必须传字符串，否则报"userId 不符合规范"
      });

      if (resp?.code === 0 && resp?.data?.accessToken) {
        // API 直接返回过期时间，无需自己计算
        account.accessToken = resp.data.accessToken;
        account.refreshToken = resp.data.refreshToken || account.refreshToken;
        account.expiresTime = resp.data.expiresTime || new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace("T", " ").substring(0, 19);
        account.refreshExpiresTime = resp.data.refreshExpiresTime || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().replace("T", " ").substring(0, 19);

        results.push({
          name: account.name,
          userId: account.userId,
          status: "✅ 成功",
          reason: null,
          newAccessToken: resp.data.accessToken.substring(0, 20) + "...",
          newRefreshToken: (resp.data.refreshToken || account.refreshToken).substring(0, 20) + "...",
          newExpiresTime: account.expiresTime,
          newRefreshExpiresTime: account.refreshExpiresTime,
          refreshTokenExpired: false,
        });
      } else {
        // 刷新失败，判断是否是 refreshToken 过期
        const errCode = resp?.code;
        const errMsg = resp?.message || JSON.stringify(resp);
        const isRefreshExpired = errCode === 8001 ||
          (errMsg && errMsg.toLowerCase().includes("refresh") && errMsg.toLowerCase().includes("expire"));

        results.push({
          name: account.name,
          userId: account.userId,
          status: "❌ 失败",
          reason: errMsg,
          newAccessToken: null,
          newRefreshToken: null,
          newExpiresTime: null,
          refreshTokenExpired: isRefreshExpired,
        });
        hasFailure = true;
      }
    } catch (err) {
      results.push({
        name: account.name,
        userId: account.userId,
        status: "❌ 异常",
        reason: err.message,
        newAccessToken: null,
        newRefreshToken: null,
        newExpiresTime: null,
        refreshTokenExpired: false,
      });
      hasFailure = true;
    }
  }

  // 写入更新后的 accounts.json
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(config, null, 2), "utf8");
  console.log("✅ accounts.json 已更新\n");

  // 打印报告
  console.log("=".repeat(70));
  console.log("         百度营销 Token 刷新结果报告");
  console.log("=".repeat(70));
  for (const r of results) {
    console.log(`\n【${r.name}】 userId=${r.userId}`);
    console.log(`  状态: ${r.status}`);
    if (r.status === "✅ 成功") {
      console.log(`  新 accessToken: ${r.newAccessToken}`);
      console.log(`  新 refreshToken: ${r.newRefreshToken}`);
      console.log(`  accessToken 过期时间: ${r.newExpiresTime}`);
      console.log(`  refreshToken 过期时间: ${r.newRefreshExpiresTime}`);
    } else {
      console.log(`  原因: ${r.reason}`);
      if (r.refreshTokenExpired) {
        console.log("  ⚠️  需要重新授权！请调用 oauth_get_auth_url 获取授权链接");
      }
    }
  }
  console.log("\n" + "=".repeat(70));

  if (hasFailure) {
    const needsReauth = results.filter(r => r.refreshTokenExpired);
    if (needsReauth.length > 0) {
      console.log("\n⚠️  以下账户需要重新授权：");
      for (const a of needsReauth) {
        console.log(`  - ${a.name} (userId=${a.userId})`);
      }
    }
  }

  process.exit(hasFailure ? 1 : 0);
}

main().catch((err) => {
  console.error("脚本异常:", err);
  process.exit(1);
});
