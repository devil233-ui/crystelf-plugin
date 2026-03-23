import configControl from '../lib/config/configControl.js';
import rssTools from '../modules/rss/rss.js';
import path from 'path';
import screenshot from '../lib/rss/screenshot.js';
import fs from 'fs';
import rssCache from '../lib/rss/rssCache.js';
import schedule from 'node-schedule';
import tools from '../components/tool.js';

export default class rssPush extends plugin {
  constructor() {
    super({
      name: 'crystelf RSS订阅',
      dsc: '定时推送rss解析流',
      priority: 114,
      rule: [
        { reg: '^#?rss添加\\s*(.+)$', fnc: 'addFeed', permission: 'master' },
        { reg: '^#?rss移除\\s*(\\d+)$', fnc: 'removeFeed', permission: 'master' },
        { reg: '^#?rss拉取\\s*(.+)$', fnc: 'pullFeedNow', permission: 'master', priority: 100 },
        { reg: '^#?rss列表$', fnc: 'listFeeds', permission: 'master' },
        { reg: /^(https?:\/\/\S+?(?:\.atom|\/feed|\.xml|\.rss))\s*$/i, fnc: 'autoAddFeed', permission: 'master', priority: 500 },
      ],
    });
    
    // 初始化确保 temp/rss 目录存在
    this.rssTempDir = path.join(process.cwd(), 'temp', 'rss');
    if (!fs.existsSync(this.rssTempDir)) {
      fs.mkdirSync(this.rssTempDir, { recursive: true });
    }

    const cronRule = '1/5 * * * *'; 
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
    if (!html) return '';
    let text = html.replace(/<\/li>|<\/ul>|<\/p>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return text.split('\n').map(l => l.trim()).filter(l => l).join('\n');
  }

  formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    } catch (e) { return ''; }
  }

  async pullFeedNow(e) {
    const url = e.msg.replace(/^#?rss拉取\s*/i, '').trim();
    if (!url) return e.reply('请提供链接');
    let latest;
    try { 
      // 60秒自动撤回提示语
      await e.reply('正在解析...', false, { recallMsg: 60 }); 
      latest = await rssTools.fetchFeed(url); 
    } catch (err) { 
      return e.reply(`失败: ${err.message}`); 
    }
    if (!latest?.length) return e.reply('无内容');

    const post = latest[0];
    const safeId = this.getSafeFilename(post.link);
    const tempPath = path.join(this.rssTempDir, `${safeId}_preview.jpg`);
    
    const cleanTitle = (post.title || '').trim();
    let desc = this.formatContent(post.content);
    if (desc.startsWith(cleanTitle)) desc = desc.substring(cleanTitle.length).trim();
    const msgBody = `[RSS预览] ${cleanTitle}\n${desc ? desc + '\n' : ''}${post.link}\n${this.formatDate(post.date)}`;

    try {
      await e.reply(msgBody);
      if (desc || post.content?.includes('<img') || post.image) {
        // 60秒自动撤回提示语
        await e.reply('正在生成截图...', false, { recallMsg: 60 });
        const resPath = await screenshot.generateScreenshot(post, tempPath);
        if (resPath && fs.existsSync(resPath)) {
          await e.reply(segment.image(resPath));
        }
      }
    } catch (err) { 
      e.reply('生成截图预览失败'); 
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  async pushFeeds() {
    let feeds = configControl.get('feeds');
    if (!Array.isArray(feeds)) return;
    for (const feed of feeds) {
      let latest;
      try { 
        latest = await rssTools.fetchFeed(feed.url); 
      } catch (e) { 
        continue; 
      }
      
      if (!latest?.length) continue;
      
      const newItems = [];
      for (let i = 0; i < Math.min(latest.length, 5); i++) {
        if (!(await rssCache.has('global_dedupe', latest[i].link))) {
          const pubDate = latest[i].date ? new Date(latest[i].date).getTime() : Date.now();
          if (Date.now() - pubDate < 86400000) {
            newItems.push(latest[i]);
          }
        }
      }
      
      if (!newItems.length) continue;
      newItems.reverse();
      
      for (const post of newItems) {
        await rssCache.set('global_dedupe', post.link);
        const cleanTitle = post.title.trim();
        let desc = this.formatContent(post.content);
        if (desc.startsWith(cleanTitle)) desc = desc.substring(cleanTitle.length).trim();
        const msgBody = `[RSS推送] ${cleanTitle}\n${desc ? desc + '\n' : ''}${post.link}\n${this.formatDate(post.date)}`;
        
        for (const groupId of feed.targetGroups) {
          await tools.sleep(2000);
          const group = Bot.pickGroup(groupId);
          if (!group) continue;
          
          await group.sendMsg(msgBody);
          
          if (feed.screenshot && (desc || post.content?.includes('<img') || post.image)) {
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
    let feeds = configControl.get('feeds') || [];
    const groupId = e.group_id;
    const exists = feeds.find((f) => f.url === url);

    if (exists) {
      if (!Array.isArray(exists.targetGroups)) exists.targetGroups = [];
      if (!exists.targetGroups.includes(groupId)) {
        exists.targetGroups.push(groupId);
        await configControl.set('feeds', feeds);
        return e.reply(`群已添加到该RSS订阅中..`, true);
      }
      return e.reply(`该RSS已存在并包含在该群聊..`, true);
    }

    feeds.push({ url, targetGroups: [groupId], screenshot: true });
    await configControl.set('feeds', feeds);
    return e.reply(`RSS订阅设置成功！`, true);
  }

  async addFeed(e) {
    const url = e.msg.replace(/^#?rss添加\s*/i, '').trim();
    if (!url) return e.reply('请输入有效的RSS链接', true);
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
    let feeds = configControl.get('feeds') || [];
    const currentGroupFeeds = feeds
      .map((f, i) => ({ i, ...f }))
      .filter((f) => f.targetGroups.includes(e.group_id));

    if (!currentGroupFeeds.length) return e.reply('当前群组暂无任何RSS订阅。', true);

    const msg = [
      `≡ 当前群组订阅列表 (${currentGroupFeeds.length}) ≡`,
      ...currentGroupFeeds.map((f) => `[${f.i}] ${f.url}`),
      '----------------',
      '提示: 使用 rss移除+索引号 取消订阅'
    ].join('\n');
    return e.reply(msg);
  }

  async removeFeed(e) {
    const match = e.msg.match(/#?rss移除\s*(\d+)/);
    if (!match) return e.reply('请指定要移除的索引，如：rss移除0', true);
    
    const index = parseInt(match[1]);
    let feeds = configControl.get('feeds') || [];
    
    if (index >= feeds.length || index < 0) return e.reply('索引无效', true);
    
    feeds[index].targetGroups = feeds[index].targetGroups.filter(id => id !== e.group_id);
    
    if (!feeds[index].targetGroups.length) {
      feeds.splice(index, 1);
    }
    
    await configControl.set('feeds', feeds);
    return e.reply('已取消订阅', true);
  }
}