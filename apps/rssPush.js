import configControl from "../lib/config/configControl.js";
import rssTools from "../modules/rss/rss.js";
import path from "path";
import screenshot from "../lib/rss/screenshot.js";
import fs from "fs";
import rssCache from "../lib/rss/rssCache.js";
import schedule from "node-schedule";
import tools from "../components/tool.js";

const MIYOUSHE_DETAIL_TTL = 30 * 60 * 1000;
const MIYOUSHE_EMOJI_TTL = 24 * 60 * 60 * 1000;
const MIYOUSHE_EMOJI_RETRY_TTL = 30 * 60 * 1000;
// 每小时的 01、02、06、07、11、12... 分执行一次，给源端同步留一个短补偿窗口。
const DEFAULT_RSS_CRON = "1/5,2/5 * * * *";
// API reference: https://github.com/KeElena/miyoushe_emoji (MIT)
const MIYOUSHE_EMOJI_API = "https://bbs-api-static.miyoushe.com/misc/api/emoticon_set?gids=2";
let miyousheEmojiCache = { expiresAt: 0, items: new Map() };

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function safeUrl(value) {
    try {
        const url = new URL(String(value || ""));
        return [ "http:", "https:" ].includes(url.protocol) ? escapeHtml(url.href) : "";
    } catch (err) {
        return "";
    }
}

function safeColor(value) {
    const color = String(value || "").trim();
    if (/^#[\da-f]{3,8}$/i.test(color)) return color;
    if (/^(?:rgb|hsl)a?\([\d\s.,%+-]+\)$/i.test(color)) return color;
    if (/^[a-z]+$/i.test(color)) return color;
    return "";
}

async function getMiyousheEmojiMap(fetcher) {
    if (miyousheEmojiCache.expiresAt > Date.now()) return miyousheEmojiCache.items;

    try {
        const response = await fetcher(MIYOUSHE_EMOJI_API, {
            headers: {
                "Referer": "https://www.miyoushe.com/",
                "User-Agent": "Mozilla/5.0",
            },
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`Status code ${response.status}`);

        const data = await response.json();
        const items = new Map();
        (data.data?.list || []).forEach(group => {
            (group.list || []).forEach(emoji => {
                if (emoji.name && emoji.icon) items.set(emoji.name, emoji.icon);
            });
        });
        miyousheEmojiCache = { items, expiresAt: Date.now() + MIYOUSHE_EMOJI_TTL };
    } catch (err) {
        miyousheEmojiCache = {
            items: miyousheEmojiCache.items,
            expiresAt: Date.now() + MIYOUSHE_EMOJI_RETRY_TTL,
        };
    }
    return miyousheEmojiCache.items;
}

function renderMiyousheLinkCard(card, inline = false) {
    if (!card) return "";
    const href = safeUrl(card.landing_url || card.origin_url);
    const cover = safeUrl(card.cover);
    const title = escapeHtml(card.title || "关联帖子");
    const inlineClass = inline ? " miyoushe-inline-card" : "";
    let html = `<a class="miyoushe-link-card${inlineClass}" href="${href}">`;
    if (cover) html += `<img class="miyoushe-link-card-cover" src="${cover}" alt="">`;
    html += `<span class="miyoushe-link-card-body"><span class="miyoushe-link-card-label">关联帖子</span><span class="miyoushe-link-card-title">${title}</span></span></a>`;
    return html;
}

function renderMiyousheText(text, emojiMap) {
    return String(text || "").split(/(_\([^)]+\))/g).map(part => {
        const match = part.match(/^_\(([^)]+)\)$/);
        if (!match) return escapeHtml(part);

        const icon = safeUrl(emojiMap.get(match[1]));
        if (!icon) return escapeHtml(part);
        return `<img class="miyoushe-emoji" src="${icon}" alt="${escapeHtml(match[1])}">`;
    }).join("");
}

function renderMiyousheInlineText(text, attributes, emojiMap) {
    let html = renderMiyousheText(text, emojiMap);
    const color = safeColor(attributes?.color);
    const href = safeUrl(attributes?.link);

    if (attributes?.bold) html = `<strong>${html}</strong>`;
    if (attributes?.italic) html = `<em>${html}</em>`;
    if (attributes?.underline) html = `<u>${html}</u>`;
    if (attributes?.strike) html = `<s>${html}</s>`;
    if (color) html = `<span style="color:${color}">${html}</span>`;
    if (href) html = `<a href="${href}">${html}</a>`;
    return html;
}

export function renderMiyousheStructuredContent(structuredContent, emojiMap = new Map()) {
    const blocks = JSON.parse(structuredContent);
    const renderedCardIds = new Set();
    let html = "";
    let line = "";

    const flushLine = (attributes = {}) => {
        const content = line.trim();
        line = "";
        if (!content) return;

        if (attributes.header === 1) {
            html += `<h2>${content}</h2>`;
        } else if (attributes.header) {
            html += `<h3>${content}</h3>`;
        } else if (attributes.blockquote) {
            html += `<blockquote><p>${content}</p></blockquote>`;
        } else if (attributes.list) {
            const marker = attributes.list === "ordered" ? "1." : "•";
            html += `<p class="miyoushe-list-item"><span>${marker}</span>${content}</p>`;
        } else {
            html += `<p>${content}</p>`;
        }
    };

    blocks.forEach(block => {
        if (typeof block.insert === "string") {
            const segments = block.insert.split("\n");
            segments.forEach((segment, index) => {
                if (segment) line += renderMiyousheInlineText(segment, block.attributes, emojiMap);
                if (index < segments.length - 1) flushLine(block.attributes);
            });
            return;
        }

        if (typeof block.insert !== "object" || !block.insert) return;
        flushLine();

        if (block.insert.image) {
            const image = safeUrl(block.insert.image);
            if (image) html += `<img src="${image}" alt="">`;
        } else if (block.insert.divider) {
            html += "<hr class=\"miyoushe-divider\">";
        } else if (block.insert.link_card) {
            const card = block.insert.link_card;
            if (card.card_id) renderedCardIds.add(String(card.card_id));
            html += renderMiyousheLinkCard(card, true);
        } else if (block.insert.backup_text) {
            const paragraphs = String(block.insert.backup_text)
                .split(/\n+/)
                .map(value => value.trim())
                .filter(Boolean)
                .map(value => `<p>${escapeHtml(value)}</p>`)
                .join("");
            if (paragraphs) html += `<div class="miyoushe-backup-text">${paragraphs}</div>`;
        }
    });

    flushLine();
    return { html, renderedCardIds };
}

export default class rssPush extends plugin {
    constructor() {
        super({
            name: "crystelf RSS订阅",
            dsc: "定时推送rss解析流",
            priority: 114,
            rule: [
                { reg: "^#?rss添加\\s*(.+)$", fnc: "addFeed", permission: "master" },
                { reg: "^#?rss移除\\s*(\\d+)$", fnc: "removeFeed", permission: "master" },
                { reg: "^#?rss拉取\\s*(.+)$", fnc: "pullFeedNow", permission: "master", priority: 100 },
                { reg: "^#?rss列表$", fnc: "listFeeds", permission: "master" },
                { reg: /^(https?:\/\/\S+?(?:\.atom|\/feed|\.xml|\.rss))\s*$/i, fnc: "autoAddFeed", permission: "master", priority: 500 },
            ],
        });

        // this._pluginPath = path.join(process.cwd(), "plugins", "crystelf");

        // 初始化确保temp目录存在
        this.rssTempDir = path.join(process.cwd(), "temp", "v", "rss");
        if (!fs.existsSync(this.rssTempDir)) {
            fs.mkdirSync(this.rssTempDir, { recursive: true });
        }

        this.miyousheDetailCache = new Map();

        if (!global.__rss_job_scheduled) {
            const configuredCron = configControl.get("config")?.rssCron;
            let cronRule = typeof configuredCron === "string" && configuredCron.trim()
                ? configuredCron.trim()
                : DEFAULT_RSS_CRON;

            const registerJob = (rule) => {
                const job = schedule.scheduleJob(rule, () => {
                    logger.mark(`[rssPush] 定时触发 (${rule})`);
                    void this.pushFeeds().catch((err) => {
                        logger.error("[rssPush] 定时推送任务异常", err);
                    });
                });
                if (!job) throw new Error("node-schedule 未创建任务");
                global.__rss_job = job;
            };

            try {
                registerJob(cronRule);
            } catch (err) {
                logger.warn(`[rssPush] RSS cron 配置无效 (${cronRule})，回退到默认规则 (${DEFAULT_RSS_CRON})`, err);
                cronRule = DEFAULT_RSS_CRON;
                registerJob(cronRule);
            }

            global.__rss_job_scheduled = true;
            logger.mark(`[rssPush] RSS 定时任务已注册 (${cronRule})`);
        }
    }

    // --- 内部工具：只提取 URL 末尾的数字作为文件名 ---
    getSafeFilename(url) {
        if (!url) return `rss_${Date.now()}`;
        const match = url.match(/(\d+)(?:\/|\?|#|$)/);
        if (match && match[1]) {
            return match[1];
        }
        return `rss_item_${Date.now()}`;
    }

    formatContent(html) {
        if (!html) return "";
        let text = html.replace(/<\/li>|<\/ul>|<\/p>/gi, "\n")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/h[1-6]>/gi, "\n\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
            .replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
        return text.split("\n").map(l => l.trim()).filter(l => l).join("\n");
    }

    formatDate(dateStr) {
        if (!dateStr) return "";
        try {
            const d = new Date(dateStr);
            return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
        } catch (e) { return ""; }
    }

    // --- 提取的公共 HTML 清理与排版方法 ---
    cleanHtmlContent(htmlContent) {
        if (!htmlContent) return "";
        let text = htmlContent.trim();
        // 1. 标签之间的换行只是 HTML 源码排版，不能渲染成额外空行。
        text = text.replace(/>\s*[\r\n]+\s*</g, "><");
        // 2. 将正文内部剩余的回车符统一转成 HTML 换行标签
        text = text.replace(/\n/g, "<br>");
        // 3. 将混杂了空格的多个连续换行合并为单个换行
        text = text.replace(/(?:[\s\xA0]*<br\s*\/?>[\s\xA0]*){2,}/gi, "<br>");
        // 4. 顺手去掉开头和结尾可能多出来的换行符
        text = text.replace(/^(?:[\s\xA0]*<br\s*\/?>[\s\xA0]*)+|(?:[\s\xA0]*<br\s*\/?>[\s\xA0]*)+$/gi, "");
        // 5. 清除图片前后的多余换行，把间距交给 CSS
        text = text.replace(/(?:[\s\xA0]*<br\s*\/?>[\s\xA0]*)+(<img[^>]+>)/gi, "$1");
        text = text.replace(/(<img[^>]+>)(?:[\s\xA0]*<br\s*\/?>[\s\xA0]*)+/gi, "$1");
        return text;
    }

    async getMiyoushePostDetail(fetcher, item) {
        const postId = item.post?.post_id;
        if (!postId) return item;

        const cached = this.miyousheDetailCache.get(postId);
        if (cached?.expiresAt > Date.now()) return cached.item;

        try {
            const detailUrl = `https://bbs-api.miyoushe.com/post/wapi/getPostFull?gids=${item.post.game_id || 2}&post_id=${postId}&read=1`;
            const response = await fetcher(detailUrl, {
                headers: {
                    "Referer": "https://www.miyoushe.com/",
                    "User-Agent": "Mozilla/5.0",
                },
                signal: AbortSignal.timeout(12000),
            });
            if (!response.ok) return item;

            const data = await response.json();
            const detailItem = data.retcode === 0 ? data.data?.post : null;
            if (!detailItem?.post) return item;

            this.miyousheDetailCache.set(postId, {
                item: detailItem,
                expiresAt: Date.now() + MIYOUSHE_DETAIL_TTL,
            });
            return detailItem;
        } catch (err) {
            return item;
        }
    }

    // --- 统一数据获取适配器 ---
    async getFeedData(url) {
        // 拦截米游社 JSON API
        if (url.includes("bbs-api.miyoushe.com/post/wapi/userPost")) {
            // 兼容 Node 原生 fetch，抓取 JSON
            const fetch = (await import("node-fetch")).default || global.fetch;
            const response = await fetch(url);
            const data = await response.json();

            if (data.retcode !== 0) throw new Error(data.message || "米游社API请求失败");
            if (!data.data || !data.data.list) return [];

            const sourceItems = data.data.list;
            const detailItems = await Promise.all(sourceItems.map((item, index) => {
                if (index >= 5) return item;
                return this.getMiyoushePostDetail(fetch, item);
            }));
            const emojiMap = await getMiyousheEmojiMap(fetch);

            // 将 JSON 映射为标准的 RSS 对象格式
            return detailItems.map(item => {
                let htmlContent = "";
                let renderedCardIds = new Set();

                // 优先尝试解析 structured_content (米游社长文专属的高级排版结构)
                if (item.post.structured_content) {
                    try {
                        const rendered = renderMiyousheStructuredContent(item.post.structured_content, emojiMap);
                        htmlContent = rendered.html;
                        renderedCardIds = rendered.renderedCardIds;
                    } catch (e) {
                        if (global.logger) global.logger.error("[RSS解析] structured_content 序列化失败", e);
                    }
                }

                // 如果没拿到结构化数据，则走文本回退逻辑
                if (!htmlContent.trim()) {
                    htmlContent = `<p>${(item.post.content || "").replace(/\n/g, "<br>")}</p>`;
                }

                // 【新增】图片提取与终极去重逻辑
                let imgPool = [];
                // 1. 塞入封面图
                if (item.post.cover) imgPool.push(item.post.cover);
                // 2. 塞入图集数组
                if (item.post.images && Array.isArray(item.post.images)) {
                    imgPool.push(...item.post.images);
                }

                // 3. 利用 Set 数据结构自动去重（解决 cover 与 images 重复的问题）
                let uniqueImgs = [ ...new Set(imgPool) ];

                // 4. 将提取出的独立图片追加到正文末尾
                uniqueImgs.forEach(img => {
                    // 核心判断：如果图片已经在 structured_content 里被渲染过了，就不再重复追加
                    if (img && !htmlContent.includes(img)) {
                        htmlContent += `<img src="${img}">`;
                    }
                });

                const linkCards = (Array.isArray(item.link_card_list) ? item.link_card_list : [])
                    .filter(card => !renderedCardIds.has(String(card.card_id)));
                if (linkCards.length) {
                    htmlContent += "<div class=\"miyoushe-link-cards\">";
                    linkCards.forEach(card => {
                        htmlContent += renderMiyousheLinkCard(card);
                    });
                    htmlContent += "</div>";
                }

                const topics = Array.isArray(item.topics) ? item.topics : [];
                if (topics.length) {
                    htmlContent += `<div class="miyoushe-topics">${topics.map(topic => `<span>${escapeHtml(topic.name)}</span>`).join("")}</div>`;
                }

                // 统一调用公共方法进行极致排版清理
                htmlContent = this.cleanHtmlContent(htmlContent);

                // 匹配对应的游戏版区
                const gameMap = { 1: "bh3", 2: "ys", 6: "sr", 8: "zzz" };
                const prefix = gameMap[item.post.game_id] || "ys";

                return {
                    title: item.post.subject,
                    author: item.user?.nickname || "米游社用户",
                    link: `https://www.miyoushe.com/${prefix}/article/${item.post.post_id}`,
                    date: item.post.created_at * 1000,
                    content: htmlContent,
                    image: item.post.cover || (item.post.images ? item.post.images[0] : ""),
                    feedTitle: `${item.user?.nickname || "用户"} 的米游社动态`
                };
            });
        }

        // 其他常规链接，继续走原本的 XML 解析
        let items = await rssTools.fetchFeed(url);

        if (Array.isArray(items)) {
            // 【终极必杀】既然底层 rssTools 会私吞 enclosure 标签，我们直接暴力请求源码自己抓！
            try {
                const fetch = (await import("node-fetch")).default || global.fetch;
                const res = await fetch(url);
                const rawXml = await res.text();

                // 按 <item> 切割源码，和 items 数组按顺序一一对应
                const xmlItems = rawXml.split(/<item[^>]*>/i).slice(1);

                items.forEach((item, index) => {
                    if (typeof item.content !== "string") {
                        item.content = item.description || "";
                    }

                    let imgUrl = "";
                    if (typeof item.image === "string") imgUrl = item.image;
                    else if (item.image && item.image.url) imgUrl = item.image.url;

                    if (!imgUrl && xmlItems[index]) {
                        const enclosureMatch = xmlItems[index].match(/<enclosure[^>]+url=["']([^"']+)["']/i);
                        if (enclosureMatch && enclosureMatch[1]) {
                            imgUrl = enclosureMatch[1];
                            // 确认没问题了，把这个刷屏的调试探针注释掉
                            // if (global.logger) global.logger.mark(`[RSS拦截] 成功从源码中暴力抢救出封面图: ${imgUrl}`);
                        }
                    }

                    if (imgUrl) {
                        item.image = imgUrl; // 确保模板能拿到背景图兜底
                        // 如果正文 HTML 里根本没有这张图，强制把它塞到正文最开头
                        if (!item.content.includes(imgUrl)) {
                            item.content = `<img src="${imgUrl}">` + item.content;
                        }
                    }

                    // 统一调用公共方法进行极致排版清理
                    item.content = this.cleanHtmlContent(item.content);
                });
            } catch (e) {
                if (global.logger) global.logger.error("[RSS解析] 暴力提取XML封面图失败", e);
            }
        }
        return items;
    }

    // --- 综合过滤逻辑 (黑白双修，黑名单绝对优先级) ---
    isFiltered(post, feedUrl = "") {
        const filterRules = configControl.get("rssFilter") || [];

        const postLink = (post.link || "").toLowerCase();
        const titleAndContent = ((post.title || "") + (post.content || "")).toLowerCase();
        const currentSource = feedUrl.toLowerCase();

        // 1. 筛选出针对当前文章和源【生效的所有规则】
        const applicableRules = filterRules.filter(rule => {
            const targetLink = (rule.link || "").toLowerCase();
            const targetSource = (rule.source || "").toLowerCase();
            if (targetLink && !postLink.includes(targetLink)) return false;
            if (targetSource && !currentSource.includes(targetSource)) return false;
            return true;
        });

        // 如果没有任何规则适用于当前文章，直接安全放行
        if (applicableRules.length === 0) return false;

        // 分离黑白名单
        const blacklists = applicableRules.filter(r => r.mode === "blacklist");
        const whitelists = applicableRules.filter(r => r.mode === "whitelist");

        // 2. 黑名单判定（最高优先级：一票否决）
        // 只要触发任意一条黑名单规则中的任意一个关键词，直接击杀
        for (const rule of blacklists) {
            if (Array.isArray(rule.keywords) && rule.keywords.some(kw => kw && titleAndContent.includes(kw.toLowerCase()))) {
                if (global.logger) global.logger.mark(`[RSS拦截] 触发黑名单: 源[${rule.source || "全局"}] 文章[${postLink}]`);
                return true;
            }
        }

        // 3. 白名单判定（准入机制）
        // 只有当该源配置了白名单时，才进行严格校验；如果没有配置白名单，则黑名单没踩雷就直接放行
        if (whitelists.length > 0) {
            let passedWhite = false;
            for (const rule of whitelists) {
                if (Array.isArray(rule.keywords) && rule.keywords.some(kw => kw && titleAndContent.includes(kw.toLowerCase()))) {
                    passedWhite = true; // 只要命中任意一个白名单规则的任意关键词，就拿到通行证
                    break;
                }
            }
            if (!passedWhite) {
                if (global.logger) global.logger.mark(`[RSS拦截] 未命中任何白名单: 源[${currentSource}] 文章[${postLink}]`);
                return true; // 拦截：因为有白名单门禁，但没刷上卡
            }
        }

        // 既没踩雷（黑），又过了门禁（白）/或无门禁限制，安全放行
        return false;
    }

    async pullFeedNow(e) {
        const url = e.msg.replace(/^#?rss拉取\s*/i, "").trim();
        if (!url) return e.reply("请提供链接");
        let latest;
        try {
            // 自动撤回提示语
            await e.reply("正在解析...", false, { recallMsg: 600 });
            latest = await this.getFeedData(url);
        } catch (err) {
            return e.reply(`失败: ${err.message}`);
        }
        if (!latest?.length) return e.reply("无内容");

        // 从最新文章中找到第一篇没有触发黑名单的
        const post = latest.find(p => !this.isFiltered(p, url));
        if (!post) return e.reply("最新文章均触发黑名单，已被拦截。", false, { recallMsg: 600 });

        const safeId = this.getSafeFilename(post.link);
        const tempPath = path.join(this.rssTempDir, `${safeId}_preview.jpg`);

        const cleanTitle = (post.title || "").trim();
        let desc = this.formatContent(post.content);
        if (desc.startsWith(cleanTitle)) desc = desc.substring(cleanTitle.length).trim();
        const msgBody = `[RSS预览] ${cleanTitle}\n${desc ? desc + "\n" : ""}${post.link}\n${this.formatDate(post.date)}`;

        let resPaths = []; // 【补上这行！被哈基米误删的罪魁祸首】
        try {
            if (desc.length > 800) {
                // 每 4000 字切片，分别做成合并转发（折叠）发送
                let chunks = [];
                for (let i = 0; i < msgBody.length; i += 4000) {
                    chunks.push(msgBody.substring(i, i + 4000));
                }
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    const forwardNode = [ { "message": chunk, "nickname": Bot.nickname, "user_id": Bot.uin } ];
                    let msgToSend = chunk;
                    try {
                        msgToSend = e.isGroup ? await e.group.makeForwardMsg(forwardNode) : await e.friend.makeForwardMsg(forwardNode);
                    } catch (err) {
                        if (global.logger) global.logger.error(`[RSS预览] 制作第 ${i + 1} 个转发消息失败，降级为截断文本`, err);
                        msgToSend = `[RSS预览] ${cleanTitle} (第 ${i + 1} 部分)\n${chunk.substring(0, 500)}...\n(正文过长截断)\n${post.link}`;
                    }
                    await e.reply(msgToSend);
                    await tools.sleep(1000); // 稍微停顿防风控
                }
            } else {
                // 短文本直接发送
                await e.reply(msgBody);
            }
            if (desc || post.content?.includes("<img") || post.image) {
                // 自动撤回提示语
                await e.reply("正在生成截图...", false, { recallMsg: 600 });
                resPaths = await screenshot.generateScreenshot(post, tempPath);
                if (resPaths && resPaths.length > 0) {
                    for (const p of resPaths) {
                        if (fs.existsSync(p)) await e.reply(segment.image(p));
                    }
                }
            }
        } catch (err) {
            e.reply("生成截图预览失败");
        } finally {
            if (resPaths && resPaths.length > 0) {
                resPaths.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
            }
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }
    }

    async pushFeeds() {
        if (global.__rss_push_running) {
            if (global.logger) global.logger.warn("[rssPush] 上一轮仍在运行，本轮跳过");
            return;
        }
        global.__rss_push_running = true;

        try {
        let feeds = configControl.get("feeds");
        if (!Array.isArray(feeds)) return;
        for (const feed of feeds) {
            let latest;
            try {
                latest = await this.getFeedData(feed.url);
            } catch (e) {
                continue;
            }

            if (!latest?.length) continue;

            const newItems = [];
            for (let i = 0; i < Math.min(latest.length, 5); i++) {
                if (!(await rssCache.has("global_dedupe", latest[i].link))) {
                    const pubDate = latest[i].date ? new Date(latest[i].date).getTime() : Date.now();
                    if (Date.now() - pubDate < 86400000) {
                        // 通过黑名单检测才允许推入发送队列
                        if (!this.isFiltered(latest[i], feed.url)) {
                            newItems.push(latest[i]);
                        }
                    }
                }
            }

            if (!newItems.length) continue;
            newItems.reverse();

            for (const post of newItems) {
                if (global.logger) global.logger.info(`[RSS推送] 准备发送: ${post.link}`);

                const cleanTitle = post.title.trim();
                let desc = this.formatContent(post.content);
                if (desc.startsWith(cleanTitle)) desc = desc.substring(cleanTitle.length).trim();
                const msgBody = `[RSS推送] ${cleanTitle}\n${desc ? desc + "\n" : ""}${post.link}\n${this.formatDate(post.date)}`;

                let pushSuccess = false; // 【新增】标记变量：是否至少成功推送到了一个群

                for (const groupId of feed.targetGroups) {
                    await tools.sleep(2000);
                    const group = Bot.pickGroup(groupId);
                    if (!group) continue;

                    try {
                        if (desc.length > 800) {
                            // 每 4000 字切片，分别做成独立的合并转发（折叠）推送
                            let chunks = [];
                            for (let i = 0; i < msgBody.length; i += 4000) {
                                chunks.push(msgBody.substring(i, i + 4000));
                            }
                            for (let i = 0; i < chunks.length; i++) {
                                const chunk = chunks[i];
                                const forwardNode = [ { "message": chunk, "nickname": Bot.nickname, "user_id": Bot.uin } ];
                                let msgToSend = chunk;
                                try {
                                    if (typeof group.makeForwardMsg === "function") {
                                        msgToSend = await group.makeForwardMsg(forwardNode);
                                    } else if (typeof Bot.makeForwardMsg === "function") {
                                        msgToSend = await Bot.makeForwardMsg(forwardNode);
                                    } else {
                                        throw new Error("当前适配器不支持在定时任务中调用合并转发API");
                                    }
                                } catch (err) {
                                    if (global.logger) global.logger.error(`[RSS推送] 制作第 ${i + 1} 个转发消息失败`, err);
                                    msgToSend = `[RSS推送] ${cleanTitle} (第 ${i + 1} 部分)\n${chunk.substring(0, 500)}...\n(正文过长截断)\n${post.link}`;
                                }
                                await group.sendMsg(msgToSend);
                                await tools.sleep(1000);
                            }
                            pushSuccess = true;
                        } else {
                            // 短动态直接单包发送
                            await group.sendMsg(msgBody);
                            pushSuccess = true;
                        }
                    } catch (err) {
                        if (global.logger) global.logger.error(`[RSS推送] 群 ${groupId} 发送文本失败:`, err);
                        continue;
                    }

                    if (feed.screenshot && (desc || post.content?.includes("<img") || post.image)) {
                        const safeId = this.getSafeFilename(post.link);
                        const tempPath = path.join(this.rssTempDir, `${safeId}_${groupId}.jpg`);

                        let resPaths = [];
                        try {
                            resPaths = await screenshot.generateScreenshot(post, tempPath);
                            if (resPaths && resPaths.length > 0) {
                                for (const p of resPaths) {
                                    if (fs.existsSync(p)) await group.sendMsg(segment.image(p));
                                }
                            }
                        } catch (e) {
                            // 忽略发送错误
                        } finally {
                            if (resPaths && resPaths.length > 0) {
                                resPaths.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });
                            }
                            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                        }
                    }
                }

                if (pushSuccess) {
                    await rssCache.set("global_dedupe", post.link);
                    if (global.logger) global.logger.info(`[RSS推送] 已写入去重缓存: ${post.link}`);
                } else {
                    if (global.logger) global.logger.warn(`[RSS推送] 致命失败：文章未成功推送到任何群聊，保留至下次重试 [${post.link}]`);
                }
            }
        }
        } finally {
            global.__rss_push_running = false;
        }
    }

    async _saveFeed(e, url) {
        let feeds = configControl.get("feeds") || [];
        const groupId = e.group_id;
        const exists = feeds.find((f) => f.url === url);

        if (exists) {
            if (!Array.isArray(exists.targetGroups)) exists.targetGroups = [];
            if (!exists.targetGroups.includes(groupId)) {
                exists.targetGroups.push(groupId);
                await configControl.set("feeds", feeds);
                return e.reply("群已添加到该RSS订阅中..", true);
            }
            return e.reply("该RSS已存在并包含在该群聊..", true);
        }

        feeds.push({ url, targetGroups: [ groupId ], screenshot: true });
        await configControl.set("feeds", feeds);
        return e.reply("RSS订阅设置成功！", true);
    }

    async addFeed(e) {
        const url = e.msg.replace(/^#?rss添加\s*/i, "").trim();
        if (!url) return e.reply("请输入有效的RSS链接", true);
        return await this._saveFeed(e, url);
    }

    async autoAddFeed(e) {
        if (!configControl.get()?.config?.rss) return;
        const match = e.msg.match(/^(https?:\/\/\S+?(?:\.atom|\/feed|\.xml|\.rss))\s*$/i);
        if (match) {
            return await this._saveFeed(e, match[1].trim());
        }
    }

    async listFeeds(e) {
        let feeds = configControl.get("feeds") || [];
        const currentGroupFeeds = feeds
            .map((f, i) => ({ i, ...f }))
            .filter((f) => f.targetGroups.includes(e.group_id));

        if (!currentGroupFeeds.length) return e.reply("当前群组暂无任何RSS订阅。", true);

        const msg = [
            `≡ 当前群组订阅列表 (${currentGroupFeeds.length}) ≡`,
            ...currentGroupFeeds.map((f) => `[${f.i}] ${f.url}`),
            "----------------",
            "提示: 使用 rss移除+索引号 取消订阅"
        ].join("\n");
        return e.reply(msg);
    }

    async removeFeed(e) {
        const match = e.msg.match(/#?rss移除\s*(\d+)/);
        if (!match) return e.reply("请指定要移除的索引，如：rss移除0", true);

        const index = parseInt(match[1]);
        let feeds = configControl.get("feeds") || [];

        if (index >= feeds.length || index < 0) return e.reply("索引无效", true);

        feeds[index].targetGroups = feeds[index].targetGroups.filter(id => id !== e.group_id);

        if (!feeds[index].targetGroups.length) {
            feeds.splice(index, 1);
        }

        await configControl.set("feeds", feeds);
        return e.reply("已取消订阅", true);
    }
}
