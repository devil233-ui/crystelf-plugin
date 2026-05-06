import configControl from "../lib/config/configControl.js";
import rssTools from "../modules/rss/rss.js";
import path from "path";
import screenshot from "../lib/rss/screenshot.js";
import fs from "fs";
import rssCache from "../lib/rss/rssCache.js";
import schedule from "node-schedule";
import tools from "../components/tool.js";

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

        this.filterDir = path.join(process.cwd(), "data", "crystelf");
        this.filterPath = path.join(this.filterDir, "rssFilter.json");

        if (!fs.existsSync(this.filterDir)) {
            fs.mkdirSync(this.filterDir, { recursive: true });
        }

        // 如果配置文件不存在，自动生成一份包含黑白名单双模式的模板
        if (!fs.existsSync(this.filterPath)) {
            const defaultFilter = [
                {
                    "link": "miyoushe.com/sr",
                    "mode": "blacklist", // 黑名单模式：包含关键词就杀
                    "keywords": [ "鸣潮", "鸣潮先约", "问卷调查" ]
                },
                {
                    "link": "miyoushe.com/zzz",
                    "mode": "whitelist", // 白名单模式：【必须】包含关键词才放行
                    "keywords": [ "" ]
                }
            ];
            fs.writeFileSync(this.filterPath, JSON.stringify(defaultFilter, null, 2), "utf-8");
            if (global.logger) global.logger.mark(`[rssPush] 已生成综合过滤配置文件: ${this.filterPath}`);
        }
        // ------------------------------------

        const cronRule = "1/5 * * * *";
        if (!global.__rss_job_scheduled) {
            schedule.scheduleJob(cronRule, () => {
                logger.mark(`[rssPush] 定时触发 (${cronRule})`);
                this.pushFeeds();
            });
            global.__rss_job_scheduled = true;
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

            // 将 JSON 映射为标准的 RSS 对象格式
            return data.data.list.map(item => {
                let htmlContent = `<p>${(item.post.content || "").replace(/\n/g, "<br>")}</p>`;
                if (item.post.images && item.post.images.length > 0) {
                    htmlContent += item.post.images.map(img => `<img src="${img}">`).join("");
                }
                // 匹配对应的游戏版区
                const gameMap = { 1: "bh3", 2: "ys", 6: "sr", 8: "zzz" };
                const prefix = gameMap[item.post.game_id] || "ys";

                return {
                    title: item.post.subject,
                    author: item.user?.nickname || "米游社用户",
                    link: `https://www.miyoushe.com/${prefix}/article/${item.post.post_id}`,
                    date: item.post.created_at * 1000, // 转为毫秒
                    content: htmlContent,
                    image: item.post.cover || (item.post.images ? item.post.images[0] : ""),
                    feedTitle: `${item.user?.nickname || "用户"} 的米游社动态`
                };
            });
        }

        // 其他常规链接，继续走原本的 XML 解析
        return await rssTools.fetchFeed(url);
    }

    // --- 综合过滤逻辑 (支持精准锁定订阅源) ---
    isFiltered(post, feedUrl = "") {
        let filterRules = [];
        try {
            if (fs.existsSync(this.filterPath)) {
                filterRules = JSON.parse(fs.readFileSync(this.filterPath, "utf-8"));
            }
        } catch (e) {
            if (global.logger) global.logger.error(`[RSS过滤] 读取配置失败: ${e.message}`);
            return false;
        }

        const postLink = (post.link || "").toLowerCase();
        const titleAndContent = ((post.title || "") + (post.content || "")).toLowerCase();
        const currentSource = feedUrl.toLowerCase();

        for (const rule of filterRules) {
            const targetLink = (rule.link || "").toLowerCase();
            const targetSource = (rule.source || "").toLowerCase(); // 新增：订阅源匹配特征

            // 校验 1：如果规则限制了文章链接特征，且不匹配，则跳过
            if (targetLink && !postLink.includes(targetLink)) continue;

            // 校验 2：如果规则限制了订阅源特征，且当前拉取的源不匹配，则跳过
            if (targetSource && !currentSource.includes(targetSource)) continue;

            // 校验 3：关键词检测
            const hasKeyword = Array.isArray(rule.keywords) && rule.keywords.some(kw => titleAndContent.includes(kw.toLowerCase()));

            if (rule.mode === "blacklist" && hasKeyword) {
                if (global.logger) global.logger.mark(`[RSS拦截] 触发黑名单: 源[${targetSource}] 文章[${postLink}]`);
                return true;
            }

            if (rule.mode === "whitelist" && !hasKeyword) {
                if (global.logger) global.logger.mark(`[RSS拦截] 未命中白名单: 源[${targetSource}] 文章[${postLink}]`);
                return true;
            }
        }

        return false;
    }

    async pullFeedNow(e) {
        const url = e.msg.replace(/^#?rss拉取\s*/i, "").trim();
        if (!url) return e.reply("请提供链接");
        let latest;
        try {
            // 60秒自动撤回提示语
            await e.reply("正在解析...", false, { recallMsg: 60 });
            latest = await this.getFeedData(url);
        } catch (err) {
            return e.reply(`失败: ${err.message}`);
        }
        if (!latest?.length) return e.reply("无内容");

        // 从最新文章中找到第一篇没有触发黑名单的
        const post = latest.find(p => !this.isFiltered(p, url));
        if (!post) return e.reply("最新文章均触发黑名单，已被拦截。", false, { recallMsg: 60 });

        const safeId = this.getSafeFilename(post.link);
        const tempPath = path.join(this.rssTempDir, `${safeId}_preview.jpg`);

        const cleanTitle = (post.title || "").trim();
        let desc = this.formatContent(post.content);
        if (desc.startsWith(cleanTitle)) desc = desc.substring(cleanTitle.length).trim();
        const msgBody = `[RSS预览] ${cleanTitle}\n${desc ? desc + "\n" : ""}${post.link}\n${this.formatDate(post.date)}`;

        let msgToSend = msgBody;
        if (desc.length > 800) {
            const forwardNode = [ { message: msgBody, nickname: Bot.nickname, user_id: Bot.uin } ];
            try {
                msgToSend = e.isGroup ? await e.group.makeForwardMsg(forwardNode) : await e.friend.makeForwardMsg(forwardNode);
            } catch (err) {
                if (global.logger) global.logger.error("[RSS预览] 制作转发消息失败", err);
            }
        }

        try {
            await e.reply(msgToSend);
            if (desc || post.content?.includes("<img") || post.image) {
                // 60秒自动撤回提示语
                await e.reply("正在生成截图...", false, { recallMsg: 60 });
                const resPath = await screenshot.generateScreenshot(post, tempPath);
                if (resPath && fs.existsSync(resPath)) {
                    await e.reply(segment.image(resPath));
                }
            }
        } catch (err) {
            e.reply("生成截图预览失败");
        } finally {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }
    }

    async pushFeeds() {
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
                await rssCache.set("global_dedupe", post.link);
                const cleanTitle = post.title.trim();
                let desc = this.formatContent(post.content);
                if (desc.startsWith(cleanTitle)) desc = desc.substring(cleanTitle.length).trim();
                const msgBody = `[RSS推送] ${cleanTitle}\n${desc ? desc + "\n" : ""}${post.link}\n${this.formatDate(post.date)}`;

                for (const groupId of feed.targetGroups) {
                    await tools.sleep(2000);
                    const group = Bot.pickGroup(groupId);
                    if (!group) continue;

                    let msgToSend = msgBody;
                    if (desc.length > 800) {
                        const forwardNode = [ { message: msgBody, nickname: Bot.nickname, user_id: Bot.uin } ];
                        try {
                            msgToSend = await group.makeForwardMsg(forwardNode);
                        } catch (err) {
                            if (global.logger) global.logger.error("[RSS推送] 制作转发消息失败", err);
                        }
                    }

                    await group.sendMsg(msgToSend);

                    if (feed.screenshot && (desc || post.content?.includes("<img") || post.image)) {
                        const safeId = this.getSafeFilename(post.link);
                        const tempPath = path.join(this.rssTempDir, `${safeId}_${groupId}.jpg`);

                        try {
                            const resPath = await screenshot.generateScreenshot(post, tempPath);
                            if (resPath && fs.existsSync(resPath)) {
                                await group.sendMsg(segment.image(resPath));
                            }
                        } catch (e) {
                            // 忽略发送错误
                        } finally {
                            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                        }
                    }
                }
            }
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