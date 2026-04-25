import MusicSearch from "../lib/music/musicSearch.js";
import Group from "../lib/yunzai/group.js";
import Message from "../lib/yunzai/message.js";
import YunzaiUtils from "../lib/yunzai/utils.js";
import ConfigControl from "../lib/config/configControl.js";

let musicSearch = globalThis.__CRYSTELF_MUSIC__;

if (!musicSearch) {
  musicSearch = new MusicSearch();
  globalThis.__CRYSTELF_MUSIC__ = musicSearch;
  musicSearch.init().then(() => {
    logger.info("[crystelf-music] 初始化");
  }).catch(err => {
    logger.error("[crystelf-music] 初始化失败: " + err);
  });
}

export class CrystelfMusic extends plugin {
  constructor() {
    super({
      name: "crystelf-music",
      dsc: "音乐点歌插件",

      event: "message.group",
      priority: -114514,

      rule: [
        {
          reg: "^#?版权点歌(.+)$",
          fnc: "handleSearch"
        },
        {
          reg: "^#听(.+)$",
          fnc: "handleDirectPlay"
        },
        {
          reg: "^#?听([1-9]|1\\d|20)$",
          fnc: "handleIndexSelection"
        }
      ]
    });
  }

  /**
   * 尝试表情点赞，失败则发送文字提示（兼容 icqq）
   */
  async tryEmojiLike(e, adapter, tipMsg = "") {
    try {
      await Message.emojiLike(e, e.message_id, 60, e.group_id, adapter);
    } catch (err) {
      if (tipMsg) {
        await e.reply(tipMsg, true);
      }
    }
  }

  async handleSearch(e) {
    try {
      if (!ConfigControl.get()?.config?.music) {
        return;
      }
      const keyword = e.msg.replace(/^#?点歌\s*/, "").trim();
      if (!keyword) {
        return await e.reply("请输入要点的歌名,例如：#点歌夜曲");
      }
      const adapter = await YunzaiUtils.getAdapter(e);
      await this.tryEmojiLike(e, adapter, "正在搜索...");
      const result = await musicSearch.handleSearch(e, keyword);
      if (result.success) {
        await e.reply({
          type: "image",
          file: `file://${result.imagePath}`
        });
      } else {
        await e.reply(`${result.message}`, true);
      }
    } catch (error) {
      logger.error("[crystelf-music] 处理搜索失败:", error);
      await e.reply("搜索失败,请稍后重试", true);
    }
  }

  async handleDirectPlay(e) {
    try {
      if (!ConfigControl.get()?.config?.music) {
        return;
      }
      const content = e.msg.replace(/^#听\s*/, "").trim();
      if (!content) {
        return await e.reply("请输入要听的歌名或序号,例如：#听 夜曲 或 #听 1", true);
      }
      const index = parseInt(content);
      if (!isNaN(index) && index >= 1 && index <= 20) {
        const searchResult = musicSearch.getGroupSearchResult(e.group_id);
        if (!searchResult) {
          return await e.reply("没有找到当前可选择的音乐列表，请先搜索歌曲", true);
        }
        const adapter = await YunzaiUtils.getAdapter(e);
        await this.tryEmojiLike(e, adapter, "正在解析...");
        const result = await musicSearch.handleSelection(e, index);
        if (result.success) {
          await this.sendMusicResult(e, result);
        } else {
          await e.reply(`${result.message}`, true);
        }
      } else {
        const adapter = await YunzaiUtils.getAdapter(e);
        await this.tryEmojiLike(e, adapter, "正在解析...");
        const result = await musicSearch.handleDirectPlay(e, content);
        if (result.success) {
          await this.sendMusicResult(e, result);
        } else {
          await e.reply(`${result.message}`, true);
        }
      }
    } catch (error) {
      logger.error("[crystelf-music] 处理直接播放失败:", error);
      await e.reply("播放失败,请稍后重试", true);
    }
  }

  async handleIndexSelection(e) {
    try {
      if (!ConfigControl.get()?.config?.music) {
        return;
      }
      const index = parseInt(e.msg);
      if (isNaN(index) || index < 1 || index > 20) {
        return;
      }
      const searchResult = musicSearch.getGroupSearchResult(e.group_id);
      if (!searchResult) {
        return;
      }
      const adapter = await YunzaiUtils.getAdapter(e);

      await this.tryEmojiLike(e, adapter, "正在解析...");

      const result = await musicSearch.handleSelection(e, index);
      if (result.success) {
        await this.sendMusicResult(e, result);
      } else {
        await e.reply(`${result.message}`, true);
      }
    } catch (error) {
      logger.error("[crystelf-music] 处理序号选择失败:", error);
    }
  }

  /**
   * 发送音乐结果 (sendUni 适配 + 扩展名还原)
   */
  async sendMusicResult(e, result) {
    try {
      const { song, audioFile, type, quality, message } = result;
      const adapter = await YunzaiUtils.getAdapter(e);
      const rawPath = audioFile.replace(/^file:\/\//, ""); 

      if (type === "voice" || quality === 1) {
        try {
            await Group.sendGroupRecord(e, e.group_id, `file://${rawPath}`, adapter);
        } catch (err) {
            if (err.message.includes("sendApi") || err.message.includes("not a function")) {
                 await e.reply(segment.record(rawPath));
            } else {
                throw err;
            }
        }
      } else {
        const extension = await this.getFileExtension();
        
        const sanitize = (str) => str.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_");
        const filename = `${sanitize(song.displayTitle)} - ${sanitize(song.displayArtist)}.${extension}`;
        
        try {
            // 尝试 OneBot 方式
            await Group.sendGroupFile(e, e.group_id, `file://${rawPath}`, filename, adapter);
        } catch (fileErr) {
            if (fileErr.message && (fileErr.message.includes("sendApi") || fileErr.message.includes("not a function"))) {
                // --- icqq 逻辑: 使用 sendUni ---
                logger.warn(`[crystelf-music] icqq 环境，尝试 sendUni 发送文件: ${filename}`);
                try {
                    await e.group.sendUni(segment.file(rawPath, filename));
                } catch (icqqErr) {
                     logger.warn(`[crystelf-music] icqq sendUni 失败，转语音: ${icqqErr.message}`);
                     await e.reply(segment.record(rawPath));
                }
            } else {
                // OneBot 失败逻辑
                logger.warn(`[crystelf-music] 文件发送失败，转为语音: ${fileErr.message}`);
                try {
                    await Group.sendGroupRecord(e, e.group_id, `file://${rawPath}`, adapter);
                } catch (voiceErr) {
                     logger.error(`[crystelf-music] 转语音也失败了: ${voiceErr.message}`);
                     await e.reply("发送失败，请检查后台日志", true);
                }
            }

        }
      }
      
      musicSearch.clearUserSelection(e.group_id, e.user_id);

      logger.info(`[crystelf-music] 音乐处理完成: ${song.displayTitle}`);
    } catch (error) {
      logger.error("[crystelf-music] 发送音乐结果彻底失败:", error);

      await e.reply("发送音乐失败,请稍后重试", true);
    }
  }

  /**
   * 获取文件扩展名 (根据配置动态决定)
   */
  async getFileExtension() {
    try {
      // 获取配置
      const musicConfig = await ConfigControl.get("music");
      
      // 预览逻辑：如果配置了音质为 '3' (无损)，则返回 flac
      if (musicConfig && String(musicConfig.quality) === "3") {
        return "flac";
      }
      
      // 其他音质（如标准、高品质）则返回 mp3
      return "mp3";
    } catch (err) {
      // 容错兜底：如果读取配置出错，默认按 flac 处理
      logger.warn("[crystelf-music] 读取音质配置失败，使用默认后缀 flac");
      return "flac";
    }
  }
}