import fs from "fs";
import path from "path";
import os from "os";
import paths from "./../../constants/path.js";
import puppeteer from "puppeteer";

let globalBrowser = null;
let activeTasks = 0;
let idleTimer = null;
let executablePath = null;

function escapeHTML(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
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
            .replace(/{{feedTitle}}/g, escapeHTML(feedItem.feedTitle || "RSS 订阅"))
            .replace(/{{image}}/g, escapeHTML(feedItem.image));

        const browser = await getBrowser();

        let page = null;
        const resultPaths = []; // 新增：用于存放所有生成的截图路径

        try {
            page = await browser.newPage();

            await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });

            await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
            await page.evaluate(async() => {
                const imageReady = Promise.all(Array.from(document.images).map((image) => {
                    if (image.complete) return image.decode?.().catch(() => { });
                    return new Promise((resolve) => {
                        image.addEventListener("load", resolve, { once: true });
                        image.addEventListener("error", resolve, { once: true });
                    });
                }));
                await Promise.race([
                    imageReady,
                    new Promise((resolve) => setTimeout(resolve, 8000)),
                ]);
                await document.fonts?.ready;
            });

            // 获取页面实际高度
            const dims = await page.evaluate(() => ({
                h: document.documentElement.scrollHeight || document.body.scrollHeight,
                w: 800
            }));
            const maxChunkHeight = 15000;

            // 分片截取逻辑
            if (dims.h <= maxChunkHeight) {
                await page.screenshot({ path: savePath, fullPage: true, type: "jpeg", quality: 92 });
                resultPaths.push(savePath);
            } else {
                let currY = 0, index = 1;
                while (currY < dims.h) {
                    const hToCap = Math.min(maxChunkHeight, dims.h - currY);
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
