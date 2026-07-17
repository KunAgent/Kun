import fs from 'fs';
import path from 'path';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function sanitizeArtifactId(value, fallback = 'result') {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

export function ensureStandardResultDirs(bookRoot) {
  const root = path.resolve(bookRoot);
  const fbsDir = path.join(root, '.fbs');
  const agentResultsDir = path.join(fbsDir, 'agent-results');
  const testResultsDir = path.join(fbsDir, 'test-results');
  ensureDir(agentResultsDir);
  ensureDir(testResultsDir);
  return { root, fbsDir, agentResultsDir, testResultsDir };
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function writeJson(filePath, payload) {
  return writeText(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeAgentFallback(bookRoot, artifactId, markdownContent) {
  if (!bookRoot || !markdownContent) return null;
  const memoryDir = path.join(path.resolve(bookRoot), '.workbuddy', 'memory');
  ensureDir(memoryDir);
  const fallbackPath = path.join(memoryDir, `agent-${sanitizeArtifactId(artifactId)}.md`);
  writeText(fallbackPath, markdownContent);
  return fallbackPath;
}

export function writeAgentResultArtifacts({ bookRoot, artifactId, jsonPayload, markdownContent }) {
  const safeId = sanitizeArtifactId(artifactId, 'agent-result');
  const result = {
    jsonPath: null,
    markdownPath: null,
    fallbackMarkdownPath: null,
  };

  try {
    const { agentResultsDir } = ensureStandardResultDirs(bookRoot);
    if (jsonPayload) {
      result.jsonPath = writeJson(path.join(agentResultsDir, `${safeId}.json`), jsonPayload);
    }
    if (markdownContent) {
      result.markdownPath = writeText(path.join(agentResultsDir, `${safeId}.md`), markdownContent);
    }
    return result;
  } catch {
    result.fallbackMarkdownPath = writeAgentFallback(bookRoot, safeId, markdownContent);
    return result;
  }
}

export function writeTestResultArtifacts({ bookRoot, artifactId, jsonPayload, markdownContent }) {
  const safeId = sanitizeArtifactId(artifactId, 'test-result');
  const { testResultsDir } = ensureStandardResultDirs(bookRoot);
  return {
    jsonPath: jsonPayload ? writeJson(path.join(testResultsDir, `${safeId}.json`), jsonPayload) : null,
    markdownPath: markdownContent ? writeText(path.join(testResultsDir, `${safeId}.md`), markdownContent) : null,
  };
}
