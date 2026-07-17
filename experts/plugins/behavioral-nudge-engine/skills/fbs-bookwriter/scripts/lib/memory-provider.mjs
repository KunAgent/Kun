import fs from "fs";
import path from "path";

function readTextIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function writeTextAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${Date.now()}`);
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

export class BuiltinMemoryProvider {
  constructor({ bookRoot, fbsDir }) {
    this.bookRoot = path.resolve(bookRoot);
    this.fbsDir = path.resolve(fbsDir || path.join(bookRoot, ".fbs"));
    this.kind = "builtin";
    this.name = "fbs-local-memory";
  }

  getMeta() {
    return {
      kind: this.kind,
      name: this.name,
      fbsDir: this.fbsDir,
      capabilities: {
        readSessionBrief: true,
        writeSessionBrief: true,
        readResumeCard: true,
      },
      files: {
        sessionBrief: path.join(this.fbsDir, "smart-memory", "session-resume-brief.md"),
        resumeCard: path.join(this.fbsDir, "workbuddy-resume.json"),
      },
    };
  }

  readSessionBrief() {
    return readTextIfExists(path.join(this.fbsDir, "smart-memory", "session-resume-brief.md"));
  }

  writeSessionBrief(content) {
    if (typeof content !== "string") return false;
    writeTextAtomic(path.join(this.fbsDir, "smart-memory", "session-resume-brief.md"), content);
    return true;
  }

  readResumeCardRaw() {
    return readTextIfExists(path.join(this.fbsDir, "workbuddy-resume.json"));
  }
}

export function createMemoryProvider({ bookRoot, fbsDir, provider = "builtin" }) {
  const wanted = String(provider || "builtin").trim().toLowerCase();
  // 当前仅落地 builtin，实现“接口先行 + 单实现”，后续可扩展外部 provider。
  if (wanted !== "builtin") {
    return new BuiltinMemoryProvider({ bookRoot, fbsDir });
  }
  return new BuiltinMemoryProvider({ bookRoot, fbsDir });
}
