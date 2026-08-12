import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(new URL("../../scripts/linuxdo_authenticated_feed.py", import.meta.url));
const REQUEST_TIMEOUT = 120000;
const CACHE_TTL = 15 * 60 * 1000;
const cache = new Map();
const pending = new Map();

export function getLinuxDoUsername(feedUrl) {
  try {
    const url = new URL(feedUrl);
    if (url.hostname.toLowerCase() !== "linux.do") return null;
    const match = url.pathname.match(/^\/u\/([^/]+)\/activity\/topics\.rss$/i);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function getLinuxDoTopicId(link) {
  try {
    const match = new URL(link).pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)(?:\/|$)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

export function mergeLinuxDoItems(publicItems, authenticatedItems) {
  const merged = new Map();
  for (const item of [ ...publicItems, ...authenticatedItems ]) {
    const key = getLinuxDoTopicId(item.link) || item.link;
    if (key) merged.set(key, item);
  }
  return [ ...merged.values() ].sort((a, b) => {
    const aTime = new Date(a.date || 0).getTime() || 0;
    const bTime = new Date(b.date || 0).getTime() || 0;
    return bTime - aTime;
  });
}

export function runLinuxDoHelper(pythonPath, input, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(pythonPath, [ SCRIPT_PATH ], {
      stdio: [ "pipe", "pipe", "pipe" ],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      err ? reject(err) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("登录主题补全请求超时"));
    }, REQUEST_TIMEOUT);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", err => finish(new Error(`无法启动curl_cffi Python: ${err.code || err.message}`)));
    child.on("close", code => {
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        const detail = stderr.trim() ? "，辅助脚本执行异常" : "";
        finish(new Error(`登录主题补全返回无效（退出码 ${code}）${detail}`));
        return;
      }
      if (code !== 0 || !result.ok) {
        finish(new Error(result.error || `登录主题补全失败（退出码 ${code}）`));
        return;
      }
      finish(null, Array.isArray(result.items) ? result.items : []);
    });
    child.stdin.on("error", err => finish(err));
    child.stdin.end(JSON.stringify(input));
  });
}

export async function fetchLinuxDoAuthenticatedItems(feedUrl, authConfig, retryCount, options = {}) {
  const username = getLinuxDoUsername(feedUrl);
  const siteConfig = authConfig?.sites?.["linux.do"];
  const cookie = String(siteConfig?.cookie || "").trim();
  const pythonPath = String(siteConfig?.curlCffiPython || "").trim();
  if (!username || siteConfig?.enabled === false || !cookie || !pythonPath) return [];

  const now = options.now?.() ?? Date.now();
  const cookieHash = createHash("sha256").update(cookie).digest("hex");
  const cacheKey = `${pythonPath}\n${username}\n${cookieHash}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.items;

  const runner = options.runner || runLinuxDoHelper;
  if (!pending.has(cacheKey)) {
    pending.set(cacheKey, runner(pythonPath, { cookie, username, retryCount })
      .then(items => {
        cache.set(cacheKey, { items, expiresAt: now + CACHE_TTL });
        return items;
      })
      .finally(() => pending.delete(cacheKey)));
  }
  return pending.get(cacheKey);
}

export function clearLinuxDoAuthenticatedCache() {
  cache.clear();
  pending.clear();
}
