#!/usr/bin/env node
/**
 * 标准执行命令链（构建虚拟书房 → 门禁校验 → S4 审校 → S5 交付 → S6 转化）
 *
 * 用法：
 *   node scripts/standard-execution-chain.mjs \
 *     --skill-root <技能根> \
 *     --book-root <本书根> \
 *     --chapter-id <章节ID> \
 *     [--mode parallel_writing|single_writer] \
 *     [--gates-only] \
 *     [--runtime-only] \
 *     [--no-verify-stages] \
 *     [--no-verify-s0-timestamp] \
 *     [--no-verify-broken-links] \
 *     [--no-auto-preview] \
 *     [--preview-port <port>] \
 *     [--preview-ttl-ms <milliseconds>] \
 *     [--with-midterm-chain] \
 *     [--midterm-chain-enforce] \
 *     [--midterm-days <days>]

 *
 * 说明：
 * - 默认模式会先跑现有门禁，再续跑 S4 → S5 → S6，使标准入口真正进入交付与转化链。
 * - `--gates-only` 保持旧行为，只执行门禁与审计。
 * - `--runtime-only` 跳过门禁，直接从已存在章节继续执行 S4 → S6，适合恢复执行或回归测试。
 */
import path from "path";
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";
import { ReviewAgent } from "./agents/review-agent.mjs";
import { DeployAgent } from "./agents/deploy-agent.mjs";
import { cleanupEventBus } from "./agents/event-bus.mjs";
import { initFbsArtifacts } from "./init-fbs-multiagent-artifacts.mjs";
import { launchPresentationPreview } from "./launch-presentation-preview.mjs";



export function parseArgs(argv) {
  const o = {
    skillRoot: process.cwd(),
    bookRoot: null,
    chapterId: null,
    mode: "parallel_writing",
    verifyStages: true,
    verifyS0Timestamp: true,
    verifyBrokenLinks: true,
    runRuntime: true,
    runtimeOnly: false,
    autoPreview: true,
    previewPort: 0,
    previewTtlMs: 10 * 60 * 1000,
    previewHost: "127.0.0.1",
    withMidtermChain: false,
    midtermChainEnforce: false,
    midtermDays: 7,
  };


  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skill-root") o.skillRoot = argv[++i];
    else if (a === "--book-root") o.bookRoot = argv[++i];
    else if (a === "--chapter-id") o.chapterId = argv[++i];
    else if (a === "--mode") o.mode = argv[++i] || o.mode;
    else if (a === "--gates-only") o.runRuntime = false;
    else if (a === "--runtime-only") o.runtimeOnly = true;
    else if (a === "--no-auto-preview") o.autoPreview = false;
    else if (a === "--preview-port") o.previewPort = Number(argv[++i] || o.previewPort);
    else if (a === "--preview-ttl-ms") o.previewTtlMs = Number(argv[++i] || o.previewTtlMs);
    else if (a === "--preview-host") o.previewHost = argv[++i] || o.previewHost;
    else if (a === "--with-midterm-chain") o.withMidtermChain = true;
    else if (a === "--midterm-chain-enforce") {
      o.withMidtermChain = true;
      o.midtermChainEnforce = true;
    }
    else if (a === "--midterm-days") o.midtermDays = Math.max(1, Number(argv[++i] || o.midtermDays));
    else if (a === "--no-verify-stages") o.verifyStages = false;
    else if (a === "--no-verify-s0-timestamp") o.verifyS0Timestamp = false;
    else if (a === "--no-verify-broken-links") o.verifyBrokenLinks = false;

  }

  return o;
}

export function validateArgs(args) {
  if (!args.bookRoot || !args.chapterId) {
    throw new Error(
      "用法: node scripts/standard-execution-chain.mjs --skill-root <技能根> --book-root <本书根> --chapter-id <章节ID> " +
        "[--mode parallel_writing|single_writer] [--gates-only] [--runtime-only] [--no-verify-stages] [--no-verify-s0-timestamp] [--no-verify-broken-links] [--no-auto-preview] [--preview-port <port>] [--preview-ttl-ms <milliseconds>] [--with-midterm-chain] [--midterm-chain-enforce] [--midterm-days <days>]"

    );
  }

  if (args.runtimeOnly && !args.runRuntime) {
    throw new Error("--runtime-only 不能与 --gates-only 同时使用");
  }

  return {
    ...args,
    skillRoot: path.resolve(args.skillRoot || process.cwd()),
    bookRoot: path.resolve(args.bookRoot),
  };
}

function runNode(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    timeout: SUBPROCESS_TIMEOUT_MS,
    killSignal: "SIGTERM",
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(`子流程超时: ${path.basename(scriptPath)} 超过 ${Math.floor(SUBPROCESS_TIMEOUT_MS / 60000)} 分钟`);
    }
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`子流程失败: ${path.basename(scriptPath)} exited with code ${result.status || 1}`);
  }
}

async function runS4Review({ bookRoot, chapterId }) {
  const reviewAgent = new ReviewAgent();
  return reviewAgent.executeTask({
    taskId: `${chapterId}-S4-standard`,
    chapterId,
    state: "S4",
    payload: { bookRoot },
  });
}

async function runS5Delivery({ bookRoot, chapterId, s4Review }) {
  const deployAgent = new DeployAgent();
  return deployAgent.executeTask({
    taskId: `${chapterId}-S5-standard`,
    chapterId,
    state: "S5",
    payload: { bookRoot, s4Review },
  });
}

async function runS6Transformation({ bookRoot, chapterId, s5Delivery }) {
  const deployAgent = new DeployAgent();
  return deployAgent.executeTask({
    taskId: `${chapterId}-S6-standard`,
    chapterId,
    state: "S6",
    payload: { bookRoot, s5Delivery },
  });
}

async function maybeLaunchPresentationPreview(args, context) {
  if (!args.runRuntime || !args.autoPreview || process.env.FBS_DISABLE_AUTO_PREVIEW === '1') {
    return null;
  }

  try {
    return await launchPresentationPreview({
      bookRoot: args.bookRoot,
      host: args.previewHost,
      port: args.previewPort,
      ttlMs: args.previewTtlMs,
      timeoutMs: 8000,
      json: false,
      limit: 20,
    });
  } catch (error) {
    console.warn(`[preview] 自动预览启动失败：${error.message}`);
    return null;
  }
}

function printRuntimeSummary({ bookRoot, s5Delivery, s6Transformation, presentationPreview }) {


  if (!s5Delivery || !s6Transformation) return;

  const primaryPresentation = s6Transformation.presentation?.primary || s5Delivery.presentation?.primary || null;

  console.log("\n📦 交付与转化结果：");
  console.log(`- S5 Markdown: ${s5Delivery.artifacts?.md?.path || "-"}`);
  console.log(`- S5 HTML: ${s5Delivery.artifacts?.html?.path || "-"}`);
  console.log(`- S5 Package: ${s5Delivery.packagePath || "-"}`);
  console.log(`- S6 内容单元: ${s6Transformation.artifacts?.contentUnitsPath || "-"}`);
  console.log(`- S6 产品路线图: ${s6Transformation.artifacts?.roadmapPath || "-"}`);
  console.log(`- S6 发布映射: ${s6Transformation.artifacts?.releaseMapPath || "-"}`);
  console.log(`- 发布区清单: ${s6Transformation.artifacts?.releaseManifestPath || "-"}`);

  if (primaryPresentation?.path) {
    console.log("\n🪟 推荐展示目标：");
    console.log(`- 目标文件: ${primaryPresentation.path}`);
    console.log(`- 建议工具: ${primaryPresentation.recommendedTool || "open_result_view"}`);

    if (presentationPreview?.url) {
      console.log("\n🌐 自动预览服务已启动：");
      console.log(`- 预览 URL: ${presentationPreview.url}`);
      console.log(`- 服务 PID: ${presentationPreview.serverPid || "-"}`);
      console.log(`- 自动过期: ${presentationPreview.ttlMs || 0}ms`);
      console.log('- 注意：这里只是启动了预览服务；宿主仍需执行 preview_url，界面里才算真正打开。');
    } else {
      console.log(`- 宿主消费入口: node scripts/host-consume-presentation.mjs --book-root "${bookRoot || path.dirname(primaryPresentation.path)}" --json`);
      console.log('- 注意：上面的命令只会返回下一步 hostAction；宿主还需继续执行 preview_url 或 open_result_view，才算真正打开。');

      if (primaryPresentation.recommendedTool === 'preview_url' && primaryPresentation.preview?.rootDir) {
        console.log(`- 预览入口: ${primaryPresentation.preview.route}`);
      }
    }


  }
}


export async function runStandardExecutionChain(rawArgs = parseArgs(process.argv)) {
  const args = validateArgs(rawArgs);
  const context = {
    skillRoot: args.skillRoot,
    bookRoot: args.bookRoot,
    chapterId: args.chapterId,
    s4Review: null,
    s5Delivery: null,
    s6Transformation: null,
    presentationPreview: null,
  };


  try {
    const steps = [
      {
        label: "构建虚拟书房底座（创建三层目录与基础工件）",

        run: () => initFbsArtifacts({ bookRoot: args.bookRoot, quiet: true }),
      },
    ];

    if (!args.runtimeOnly) {
      steps.push(
        {
          label: "执行 S3 启动门禁",
          run: () => {
            const s3Args = ["--skill-root", args.skillRoot, "--book-root", args.bookRoot, "--mode", args.mode];
            if (args.verifyStages) s3Args.push("--verify-stages");
            runNode(path.join(args.skillRoot, "scripts", "s3-start-gate.mjs"), s3Args);
          },
        },
        {
          label: "执行章节检索门禁（含原子性）",
          run: () => {
            const chapterArgs = [
              "--skill-root",
              args.skillRoot,
              "--book-root",
              args.bookRoot,
              "--chapter-id",
              args.chapterId,
              "--verify-atomicity",
            ];
            if (args.verifyStages) {
              chapterArgs.push("--verify-stages", "--stage-scope", "pre-s3");
            }
            if (!args.verifyS0Timestamp) {
              chapterArgs.push("--no-verify-s0-timestamp");
            }
            runNode(path.join(args.skillRoot, "scripts", "enforce-search-policy.mjs"), chapterArgs);
          },
        },
        {
          label: args.verifyBrokenLinks ? "执行文档断链审计" : "跳过文档断链审计（--no-verify-broken-links）",
          run: () => {
            if (!args.verifyBrokenLinks) return;
            runNode(path.join(args.skillRoot, "scripts", "audit-broken-links.mjs"), ["--root", args.skillRoot, "--channel", "user", "--enforce"]);
          },
        }
      );
    }

    if (args.runRuntime) {
      steps.push(
        {
          label: "执行 S4 审校",
          run: async () => {
            context.s4Review = await runS4Review(context);
            if (!context.s4Review?.passed) {
              const issueSummary = (context.s4Review?.issues || [])
                .slice(0, 3)
                .map(issue => issue.description || issue.type)
                .filter(Boolean)
                .join("；");
              throw new Error(`章节 ${context.chapterId} 未通过 S4 审校${issueSummary ? `：${issueSummary}` : ""}`);
            }
          },
        },
        {
          label: "执行 S5 交付",
          run: async () => {
            context.s5Delivery = await runS5Delivery(context);
          },
        },
        {
          label: "执行 S6 转化与发布映射",
          run: async () => {
            context.s6Transformation = await runS6Transformation(context);
          },
        }
      );
    }

    for (const [index, step] of steps.entries()) {
      console.log(`[${index + 1}/${steps.length}] ${step.label}...`);
      await step.run();
    }

    if (args.runRuntime) {
      context.presentationPreview = await maybeLaunchPresentationPreview(args, context);
      printRuntimeSummary(context);
    }

    if (args.withMidtermChain) {
      const midtermArgs = [
        "--book-root",
        args.bookRoot,
        "--skill-root",
        args.skillRoot,
        "--days",
        String(args.midtermDays),
        "--json",
      ];
      if (args.midtermChainEnforce) midtermArgs.push("--enforce");
      console.log(`[midterm-chain] 追加执行中期执行链（days=${args.midtermDays}${args.midtermChainEnforce ? ", enforce" : ""}）`);
      runNode(path.join(args.skillRoot, "scripts", "midterm-execution-chain.mjs"), midtermArgs);
    }


    console.log("✅ standard-execution-chain: 全部通过");
    return context;
  } finally {
    cleanupEventBus();
  }
}

export async function main() {
  try {
    await runStandardExecutionChain();
  } catch (error) {
    console.error(`❌ standard-execution-chain: ${error.message}`);
    process.exit(1);
  }
}


const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  await main();
}
