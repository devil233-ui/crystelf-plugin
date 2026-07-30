import Path from "../../constants/path.js";
import path from "path";
import fs from "fs";
import fc from "../../components/json.js";

const fsp = fs.promises;
const pluginConfigPath = Path.defaultConfigPath;
const activeConfigPath = Path.config;
const legacyConfigPath = Path.runtimeData;
let configCache = {};
let watchers = [];

/**
 * 初始化配置
 */
async function init() {
  try {
    try {
      await fsp.access(activeConfigPath);
    } catch {
      await fsp.mkdir(activeConfigPath, { recursive: true });
      logger.mark(`[crystelf-plugin] 配置目录创建成功: ${activeConfigPath}`);
    }

    try {
      await fsp.access(pluginConfigPath);
    } catch {
      logger.warn(`[crystelf-plugin] 默认配置目录不存在: ${pluginConfigPath}`);
    }

    let pluginFiles = [];
    try {
      pluginFiles = (await fsp.readdir(pluginConfigPath)).filter((f) => f.endsWith(".json"));
    } catch (error) {
      logger.warn(`[crystelf-plugin] 读取默认配置目录失败: ${error}`);
    }

    for (const file of pluginFiles) {
      const pluginFilePath = path.join(pluginConfigPath, file);
      const activeFilePath = path.join(activeConfigPath, file);
      try {
        await fsp.access(activeFilePath);
      } catch {
        try {
          const legacyFilePath = path.join(legacyConfigPath, file);
          let sourcePath = pluginFilePath;
          try {
            await fsp.access(legacyFilePath);
            sourcePath = legacyFilePath;
          } catch {}
          await fsp.copyFile(sourcePath, activeFilePath);
          const sourceType = sourcePath === legacyFilePath ? "旧配置" : "默认配置";
          logger.mark(`[crystelf-plugin] 已从${sourceType}创建: ${file}`);
        } catch (copyError) {
          logger.warn(`[crystelf-plugin] 复制配置文件失败 ${file}: ${copyError}`);
        }
      }
    }

    const files = (await fsp.readdir(activeConfigPath)).filter((f) => f.endsWith(".json"));
    configCache = {};

    for (const file of files) {
      const filePath = path.join(activeConfigPath, file);
      const name = path.basename(file, ".json");
      try {
        configCache[name] = await fc.readJSON(filePath);
      } catch (error) {
        logger.warn(`[crystelf-plugin] 读取配置文件 ${file} 失败:`, error);
      }
    }

    if (configCache.config?.debug) {
      logger.info("[crystelf-plugin] 配置模块初始化成功..");
    }
  } catch (err) {
    logger.warn("[crystelf-plugin] 配置初始化失败,使用空配置..", err);
    configCache = {};
  }
}

/**
 * 配置文件热更新
 */
function watchConfigs() {
  for (const watcher of watchers) {
    watcher.close();
  }
  watchers = [];

  fsp.readdir(activeConfigPath).then((files) => {
    files
      .filter((f) => f.endsWith(".json"))
      .forEach((file) => {
        const filePath = path.join(activeConfigPath, file);
        const watcher = fs.watch(filePath, async(eventType) => {
          if (eventType !== "change") return;
          try {
            const name = path.basename(file, ".json");
            const data = await fc.readJSON(filePath);
            configCache[name] = data;
            logger.info(`[crystelf-plugin] 配置热更新: ${file}`);
          } catch (e) {
            logger.warn(`[crystelf-plugin] 热更新读取失败 ${file}:`, e);
          }
        });
        watchers.push(watcher);
      });
  });
}

const configControl = {
  async init() {
    await init();
    watchConfigs();
  },

  get(key) {
    return key ? configCache[key] : configCache;
  },

  async set(key, value) {
    configCache[key] = value;
    const filePath = path.join(activeConfigPath, `${key}.json`);

    try {
      await fsp.access(filePath);
      await fc.writeJSON(filePath, value);
    } catch (error) {
      try {
        await fsp.mkdir(activeConfigPath, { recursive: true });
        await fc.writeJSON(filePath, value);
        logger.mark(`[crystelf-plugin] 创建新配置文件: ${filePath}`);
      } catch (writeError) {
        logger.error(`[crystelf-plugin] 创建配置文件失败: ${writeError}`);
        throw writeError;
      }
    }
  },

  async setMultiple(configs) {
    await fsp.mkdir(activeConfigPath, { recursive: true });

    for (const [ key, value ] of Object.entries(configs)) {
      try {
        configCache[key] = value;
        const filePath = path.join(activeConfigPath, `${key}.json`);
        await fc.writeJSON(filePath, value);
      } catch (error) {
        logger.error(`[crystelf-plugin] 设置配置失败 ${key}: ${error}`);
        throw error;
      }
    }
  },

  async save() {
    await fsp.mkdir(activeConfigPath, { recursive: true });

    for (const [ key, value ] of Object.entries(configCache)) {
      const filePath = path.join(activeConfigPath, `${key}.json`);
      try {
        await fc.writeJSON(filePath, value);
      } catch (error) {
        logger.error(`[crystelf-plugin] 保存配置文件失败 ${filePath}: ${error}`);
        throw error;
      }
    }
  },

  async reload() {
    await init();
    watchConfigs();
    return true;
  },
};

export default configControl;
