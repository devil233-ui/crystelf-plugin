import fs from "fs";
import path from "path";
import os from "os";
import paths from "./../../constants/path.js";
import puppeteer from "puppeteer";

const IMAGE_LOAD_TIMEOUT_MS = 30000;
const IMAGE_FETCH_TIMEOUT_MS = 30000;
const IMAGE_FETCH_RETRIES = 3;
const IMAGE_FETCH_CONCURRENCY = 1;
const IMAGE_CACHE_TTL_MS = 30 * 60 * 1000;
const IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const PREFERRED_CHUNK_HEIGHT = 15000;
const MAX_CHUNK_HEIGHT = 18000;
const MIN_TAIL_CHUNK_HEIGHT = 2000;

const imageResourceCache = new Map();
let imageResourceCacheBytes = 0;

let globalBrowser = null;
let activeTasks = 0;
let idleTimer = null;
let executablePath = null;

export function getChunkHeights(totalHeight) {
    if (totalHeight <= MAX_CHUNK_HEIGHT) return [ totalHeight ];
    const preferredChunkCount = Math.ceil(totalHeight / PREFERRED_CHUNK_HEIGHT);
    const tailHeight = totalHeight % PREFERRED_CHUNK_HEIGHT;
    let chunkHeight = PREFERRED_CHUNK_HEIGHT;
    if (tailHeight > 0 && tailHeight < MIN_TAIL_CHUNK_HEIGHT) {
        const balancedCount = preferredChunkCount - 1;
        const balancedHeight = Math.ceil(totalHeight / balancedCount);
        if (balancedHeight <= MAX_CHUNK_HEIGHT) chunkHeight = balancedHeight;
    }
    const heights = [];
    let remaining = totalHeight;
    while (remaining > 0) {
        const height = Math.min(chunkHeight, remaining);
        heights.push(height);
        remaining -= height;
    }
    return heights;
}

function escapeHTML(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function extractImageUrls(html) {
    const urls = new Set();
    const imagePattern = /<img\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)')/gi;
    for (const match of html.matchAll(imagePattern)) {
        const source = (match[1] || match[2] || "").replace(/&amp;/g, "&");
        try {
            const url = new URL(source);
            if (
                [ "http:", "https:" ].includes(url.protocol) &&
                (url.hostname === "miyoushe.com" || url.hostname.endsWith(".miyoushe.com"))
            ) {
                urls.add(url.href);
            }
        } catch {}
    }
    return [ ...urls ];
}

async function fetchImageResource(url) {
    const cached = imageResourceCache.get(url);
    if (cached?.expiresAt > Date.now()) return cached.resource;
    if (cached) {
        imageResourceCache.delete(url);
        imageResourceCacheBytes -= cached.resource.body.length;
    }

    let lastError;
    for (let attempt = 1; attempt <= IMAGE_FETCH_RETRIES; attempt++) {
        try {
            const response = await fetch(url, {
                headers: {
                    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                    "Referer": "https://www.miyoushe.com/",
                    "User-Agent": "Mozilla/5.0",
                },
                signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const resource = {
                body: Buffer.from(await response.arrayBuffer()),
                contentType: response.headers.get("content-type") || "application/octet-stream",
            };
            while (
                imageResourceCache.size > 0 &&
                imageResourceCacheBytes + resource.body.length > IMAGE_CACHE_MAX_BYTES
            ) {
                const [ oldestUrl, oldest ] = imageResourceCache.entries().next().value;
                imageResourceCache.delete(oldestUrl);
                imageResourceCacheBytes -= oldest.resource.body.length;
            }
            if (resource.body.length <= IMAGE_CACHE_MAX_BYTES) {
                imageResourceCache.set(url, {
                    resource,
                    expiresAt: Date.now() + IMAGE_CACHE_TTL_MS,
                });
                imageResourceCacheBytes += resource.body.length;
            }
            return resource;
        } catch (error) {
            lastError = error;
            if (attempt < IMAGE_FETCH_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, attempt * 500));
            }
        }
    }
    throw lastError;
}

async function prefetchImageResources(html) {
    const urls = extractImageUrls(html);
    const resources = new Map();
    let cursor = 0;

    const worker = async() => {
        while (cursor < urls.length) {
            const url = urls[cursor++];
            try {
                resources.set(url, await fetchImageResource(url));
            } catch (error) {
                if (global.logger) {
                    global.logger.warn(`[RSS截图] 图片预取失败: ${url} (${error.message})`);
                }
            }
        }
    };

    const workerCount = Math.min(IMAGE_FETCH_CONCURRENCY, urls.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return { resources, total: urls.length };
}

function formatPublishDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(date).replace(/\//g, "-");
}

export function formatSourceTitle(feedItem) {
    const author = String(feedItem.author || "未知作者").trim();
    const feedTitle = String(feedItem.feedTitle || "RSS 订阅").trim();
    let hostname = "";

    try {
        hostname = new URL(feedItem.feedLink || feedItem.link).hostname.toLowerCase();
    } catch (err) {
        hostname = "";
    }

    const siteName = feedTitle
        .replace(/\s*[-–—|]\s*.+?\s*的(?:最新)?(?:话题|主题|帖子|动态)\s*$/i, "")
        .replace(/^.+?\s*的米游社动态$/i, "米游社")
        .trim() || hostname || "RSS 订阅";

    if (!author || author === "未知作者") return siteName;
    return `${siteName} - ${author}`;
}

async function getChromiumPath() {
    if (executablePath) return executablePath;
    const systemPaths = [
        "/usr/bin/chromium-browser", "/usr/bin/chromium",
        "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    ];
    for (const sp of systemPaths) {
        if (fs.existsSync(sp)) return (executablePath = sp);
    }
    try { executablePath = puppeteer.executablePath(); } catch (e) { executablePath = null; }
    return executablePath;
}

async function getBrowser() {
    if (!globalBrowser || !globalBrowser.isConnected()) {
        const exePath = await getChromiumPath();
        globalBrowser = await puppeteer.launch({
            headless: "new",
            executablePath: exePath || undefined,
            args: [
                "--no-sandbox", "--disable-setuid-sandbox",
                "--disable-dev-shm-usage", "--disable-gpu",
                "--disable-web-security"
            ],
        });
        if (global.logger) global.logger.info(`[RSS截图] 浏览器启动，路径: ${exePath || "默认内置"}`);
    }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    activeTasks++;
    return globalBrowser;
}

function releaseBrowser() {
    activeTasks = Math.max(0, activeTasks - 1);
    if (activeTasks === 0) {
        idleTimer = setTimeout(async() => {
            if (activeTasks === 0 && globalBrowser) {
                await globalBrowser.close().catch(() => { });
                globalBrowser = null;
                if (global.logger) global.logger.info("[RSS截图] 浏览器已空闲休眠");
            }
        }, 30000);
    }
}

const screenshot = {
    async generateScreenshot(feedItem, savePath) {
        savePath = savePath.replace(/\.(png|img)$/i, ".jpg");

        const htmlTemplate = fs.readFileSync(paths.rssHTML, "utf-8");

        let safeContent = feedItem.content || "";

        // 统一字号，避免订阅源的内联样式破坏截图布局。
        safeContent = safeContent
            .replace(/font-size:\s*[^;"]+;?/gi, "")
            .replace(/(<img\b[^>]*>)\s*<br\s*\/?\s*>/gi, "$1")
            .replace(/<p>\s*(?:<br\s*\/?\s*>\s*)*<\/p>/gi, "")
            .replace(/<p>\s*<a\b[^>]*>\s*(?:阅读完整话题|Read Full Topic)\s*<\/a>\s*<\/p>\s*$/i, "");
        safeContent = "<div id=\"crystelf-super-text\">" + safeContent + "</div>";

        const html = htmlTemplate
            .replace(/{{title}}/g, escapeHTML(feedItem.title || "无标题"))
            .replace(/{{author}}/g, escapeHTML(feedItem.author || "未知作者"))
            .replace(/{{content}}/g, safeContent)
            .replace(/{{link}}/g, escapeHTML(feedItem.link))
            .replace(/{{date}}/g, formatPublishDate(feedItem.date))
            .replace(/{{sourceTitle}}/g, escapeHTML(formatSourceTitle(feedItem)))
            .replace(/{{feedTitle}}/g, escapeHTML(feedItem.feedTitle || "RSS 订阅"))
            .replace(/{{image}}/g, escapeHTML(feedItem.image));

        const browser = await getBrowser();

        let page = null;
        const resultPaths = []; // 新增：用于存放所有生成的截图路径

        try {
            page = await browser.newPage();

            await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
            if (feedItem.link?.includes("miyoushe.com")) {
                await page.setExtraHTTPHeaders({ Referer: "https://www.miyoushe.com/" });
            }

            const prefetched = feedItem.link?.includes("miyoushe.com")
                ? await prefetchImageResources(html)
                : { resources: new Map(), total: 0 };
            if (prefetched.resources.size > 0) {
                await page.setRequestInterception(true);
                page.on("request", (request) => {
                    const resource = prefetched.resources.get(request.url());
                    const action = resource
                        ? request.respond({
                            status: 200,
                            contentType: resource.contentType,
                            body: resource.body,
                        })
                        : request.continue();
                    action.catch(() => request.continue().catch(() => {}));
                });
            }
            if (global.logger && prefetched.total > 0) {
                global.logger.info(
                    `[RSS截图] 图片预取完成: ${prefetched.resources.size}/${prefetched.total}`
                );
            }

            await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
            const imageLoadResult = await page.evaluate(async(timeoutMs) => {
                const waitForImage = async(image) => {
                    if (!image.complete || image.naturalWidth === 0) {
                        await new Promise((resolve) => {
                            let timer;
                            const done = () => {
                                clearTimeout(timer);
                                image.removeEventListener("load", done);
                                image.removeEventListener("error", done);
                                resolve();
                            };
                            image.addEventListener("load", done, { once: true });
                            image.addEventListener("error", done, { once: true });
                            timer = setTimeout(done, timeoutMs);
                        });
                    }

                    if (image.naturalWidth > 0 && typeof image.decode === "function") {
                        await image.decode().catch(() => {});
                    }
                };

                const images = Array.from(document.images);
                images.forEach((image) => {
                    image.loading = "eager";
                });
                await Promise.all(images.map(waitForImage));

                const failedImages = images.filter(image => image.naturalWidth === 0 && image.src);
                await Promise.all(failedImages.map((image, index) => {
                    const source = image.currentSrc || image.src;
                    image.removeAttribute("srcset");
                    image.src = `${source}${source.includes("?") ? "&" : "?"}rss_retry=${Date.now()}_${index}`;
                    return waitForImage(image);
                }));

                await document.fonts?.ready;
                await new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                });

                return {
                    total: images.length,
                    failed: images.filter(image => image.naturalWidth === 0 && image.src).length,
                };
            }, IMAGE_LOAD_TIMEOUT_MS);

            if (imageLoadResult.failed > 0 && global.logger) {
                global.logger.warn(
                    `[RSS截图] ${imageLoadResult.failed}/${imageLoadResult.total} 张图片加载失败，继续生成截图`
                );
            }

            // 获取页面实际高度
            const dims = await page.evaluate(() => ({
                h: document.documentElement.scrollHeight || document.body.scrollHeight,
                w: 800
            }));
            // 优先保留长图；页面略超首选高度时不单独生成尾部小图。
            const chunkHeights = getChunkHeights(dims.h);
            if (chunkHeights.length === 1) {
                await page.screenshot({ path: savePath, fullPage: true, type: "jpeg", quality: 92 });
                resultPaths.push(savePath);
            } else {
                const preferredChunkCount = Math.ceil(dims.h / PREFERRED_CHUNK_HEIGHT);
                const tailHeight = dims.h % PREFERRED_CHUNK_HEIGHT;
                let chunkHeight = PREFERRED_CHUNK_HEIGHT;

                if (tailHeight > 0 && tailHeight < MIN_TAIL_CHUNK_HEIGHT) {
                    const balancedCount = preferredChunkCount - 1;
                    const balancedHeight = Math.ceil(dims.h / balancedCount);
                    if (balancedHeight <= MAX_CHUNK_HEIGHT) {
                        chunkHeight = balancedHeight;
                    }
                }

                let currY = 0, index = 1;
                while (currY < dims.h) {
                    const hToCap = Math.min(chunkHeight, dims.h - currY);
                    const chunkPath = savePath.replace(/\.jpg$/i, `_${index}.jpg`);
                    await page.screenshot({
                        path: chunkPath,
                        clip: { x: 0, y: currY, width: dims.w, height: hToCap },
                        type: "jpeg",
                        quality: 92
                    });
                    resultPaths.push(chunkPath);
                    currY += hToCap;
                    index++;
                }
            }

        } catch (err) {
            if (global.logger) global.logger.error(`[RSS截图] 失败: ${err.message}`);
        } finally {
            if (page) await page.close().catch(() => { });
            releaseBrowser();
        }

        // 【修改】现在返回的是路径数组
        return resultPaths;
    },
};

export default screenshot;
