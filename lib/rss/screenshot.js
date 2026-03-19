import fs from 'fs';
import path from 'path';
import os from 'os';
import paths from './../../constants/path.js';
import puppeteer from 'puppeteer';
import tools from './../../components/tool.js';

let globalBrowser = null;
let activeTasks = 0;
let idleTimer = null;
let executablePath = null;

async function getChromiumPath() {
  if (executablePath) return executablePath;
  const systemPaths = [
    '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
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
      headless: 'new',
      executablePath: exePath || undefined,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage', '--disable-gpu', 
        '--disable-web-security'
      ],
    });
    if (global.logger) global.logger.info(`[RSS截图] 浏览器启动，路径: ${exePath || '默认内置'}`);
  }
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  activeTasks++;
  return globalBrowser;
}

function releaseBrowser() {
  activeTasks = Math.max(0, activeTasks - 1);
  if (activeTasks === 0) {
    idleTimer = setTimeout(async () => {
      if (activeTasks === 0 && globalBrowser) {
        await globalBrowser.close().catch(() => {});
        globalBrowser = null;
        if (global.logger) global.logger.info('[RSS截图] 浏览器已空闲休眠');
      }
    }, 30000);
  }
}

const screenshot = {
  async generateScreenshot(feedItem, savePath) {
    savePath = savePath.replace(/\.(png|img)$/i, '.jpg');
    
    const htmlTemplate = fs.readFileSync(paths.rssHTML, 'utf-8');
    const cssFix = `<style>.ql-image,.ql-image-box,figure,div,p{max-width:100%!important;height:auto!important;overflow:hidden!important}img{max-width:100%!important;height:auto!important;display:block!important;margin:0 auto!important;object-fit:contain!important}</style>`;
    
    // 【核心进化】智能暗色拦截器：
    // 不仅拦截纯黑和 hex 深灰，还拦截所有 rgb(0~99, 0~99, 0~99) 这种三色均不过百的暗色系，彻底告别背景融色！
    let safeContent = feedItem.content || '';
    safeContent = safeContent.replace(/color:\s*(?:#000000|#000|#111111|#111|#222222|#222|#333333|#333|black|rgba?\(\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*(?:,[^\)]+)?\));?/gi, 'color: #eeeeee;');
    
    const html = htmlTemplate
      .replace(/{{title}}/g, feedItem.title).replace(/{{author}}/g, feedItem.author)
      .replace(/{{content}}/g, cssFix + safeContent)
      .replace(/{{link}}/g, feedItem.link).replace(/{{date}}/g, new Date(feedItem.date).toLocaleString())
      .replace(/{{feedTitle}}/g, feedItem.feedTitle).replace(/{{image}}/g, feedItem.image || '');

    const browser = await getBrowser();
    let page = null;

    try {
      page = await browser.newPage();
      
      await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: 1 });
      
      await page.setContent(html, { waitUntil: 'networkidle2', timeout: 60000 });
      
      await tools.sleep(5000);

      await page.screenshot({ path: savePath, fullPage: true, type: 'jpeg', quality: 80 });
      
      return savePath;

    } catch (err) { 
      if (global.logger) global.logger.error(`[RSS截图] 失败: ${err.message}`); 
      return null;
    } finally { 
      if (page) await page.close().catch(() => {}); 
      releaseBrowser(); 
    }
  },
};

export default screenshot;