import fs from "fs";
import path from "path";
import os from "os";
import paths from "./../../constants/path.js";
import puppeteer from "puppeteer";
import tools from "./../../components/tool.js";

let globalBrowser = null;
let activeTasks = 0;
let idleTimer = null;
let executablePath = null;

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

        // 1. 保留正则：专杀官方强加的隐形深色，转为纯白（同时保留原有的红黄蓝彩色高亮）
        const darkRgbPattern = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(?:[^\)]+)\s*)?\)/gi;
        safeContent = safeContent.replace(darkRgbPattern, (fullMatch, rStr, gStr, bStr) => {
            const r = parseInt(rStr, 10), g = parseInt(gStr, 10), b = parseInt(bStr, 10);
            if (r < 100 && g < 100 && b < 100) return "rgb(255, 255, 255)";
            return fullMatch;
        });
        safeContent = safeContent.replace(/color:\s*(?:#000000|#000|#111111|#111|#222222|#222|#333333|#333|black|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(?:,[^\)]+)?\));?/gi, "color: #FFFFFF;");

        // 2. 清理内联字号，防止官方瞎排版干扰我们放大
        safeContent = safeContent.replace(/font-size:\s*[^;"]+;?/gi, "");

        // 3. 终极 CSS 补丁：用 :not 选择器绕开彩色字，把剩下的基础字全刷成纯白
        // 下猛药：正文 40px，标题同步起飞
        const cssFix = `<style>
      /* 1. 顶部标题与元数据处理 */
      h1, .title, {{title}} { 
        font-size: 54px !important; 
        line-height: 1.2 !important; 
        color: #FFFFFF !important;
        margin-bottom: 20px !important;
        font-weight: bold !important;
      }
      .author, .date, .metadata { 
        font-size: 24px !important; 
        color: #BBBBBB !important; 
        margin-bottom: 30px !important;
      }

      /* 2. 正文穿透覆盖：强制 40px 纯白 */
      #crystelf-super-text, #crystelf-super-text * {
        font-size: 40px !important; 
        line-height: 1.5 !important;
        color: #FFFFFF !important;
      }
      
      /* 3. 抹除所有自带的深色，确保纯净 */
      #crystelf-super-text *:not([style*="color"]) {
        color: #FFFFFF !important;
      }

      /* 4. 图片与容器规整 */
      .ql-image, .ql-image-box, figure, p, div { max-width:100%!important; height:auto!important; }
      img { max-width:100%!important; height:auto!important; display:block!important; margin:30px auto!important; object-fit:contain!important; }
    </style>`;

        // 依然要套这个盒子
        safeContent = "<div id=\"crystelf-super-text\">" + safeContent + "</div>";

        const html = htmlTemplate
            .replace(/{{title}}/g, feedItem.title).replace(/{{author}}/g, feedItem.author)
            .replace(/{{content}}/g, cssFix + safeContent)
            .replace(/{{link}}/g, feedItem.link).replace(/{{date}}/g, new Date(feedItem.date).toLocaleString())
            .replace(/{{feedTitle}}/g, feedItem.feedTitle).replace(/{{image}}/g, feedItem.image || "");

        const browser = await getBrowser();

        let page = null;
        const resultPaths = []; // 新增：用于存放所有生成的截图路径

        try {
            page = await browser.newPage();

            await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: 1 });

            await page.setContent(html, { waitUntil: "networkidle2", timeout: 60000 });

            // 保留 10 秒缓冲，保证图片和长图排版加载完毕
            await tools.sleep(10000);

            // 获取页面实际高度
            const dims = await page.evaluate(() => ({
                h: document.documentElement.scrollHeight || document.body.scrollHeight,
                w: 800
            }));
            const maxChunkHeight = 15000;

            // 分片截取逻辑
            if (dims.h <= maxChunkHeight) {
                await page.screenshot({ path: savePath, fullPage: true, type: "jpeg", quality: 100 });
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
                        quality: 100
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