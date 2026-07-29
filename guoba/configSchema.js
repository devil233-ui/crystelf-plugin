const guobaSchema = [
  // config.json - 主配置
  {
    label: "主配置",
    component: "SOFT_GROUP_BEGIN",
  },
  {
    field: "config.debug",
    label: "调试模式",
    component: "Switch",
    bottomHelpMessage: "是否启用调试模式",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "config.maxFeed",
    label: "最长订阅",
    component: "InputNumber",
    bottomHelpMessage: "最长订阅数量",
    componentProps: {
      min: 1,
      max: 50,
      step: 1,
      placeholder: "请输入最长订阅数量",
    },
  },
  {
    field: "config.autoUpdate",
    label: "自动更新",
    component: "Switch",
    bottomHelpMessage: "是否自动更新插件",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "config.poke",
    label: "戳一戳功能",
    component: "Switch",
    bottomHelpMessage: "是否启用戳一戳功能",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "config.60s",
    label: "60s新闻",
    component: "Switch",
    bottomHelpMessage: "是否启用60s新闻功能",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "config.zwa",
    label: "早晚安",
    component: "Switch",
    bottomHelpMessage: "是否启用早晚安功能",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "config.rss",
    label: "RSS订阅",
    component: "Switch",
    bottomHelpMessage: "是否启用RSS订阅功能",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "config.welcome",
    label: "入群欢迎功能",
    component: "Switch",
    bottomHelpMessage: "是否启用欢迎功能",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "config.faceReply",
    label: "表情回复（贴表情）",
    component: "Switch",
    bottomHelpMessage: "是否启用表情回复功能",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "config.music",
    label: "点歌",
    component: "Switch",
    bottomHelpMessage: "是否启用点歌功能",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "config.auth",
    label: "入群验证功能",
    component: "Switch",
    bottomHelpMessage: "是否启用入群验证",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },

  // coreConfig.json - 核心配置
  {
    label: "晶灵核心配置",
    component: "SOFT_GROUP_BEGIN",
  },
  {
    field: "coreConfig.coreUrl",
    label: "核心API地址",
    component: "Input",
    bottomHelpMessage: "晶灵核心API地址",
    componentProps: {
      placeholder: "请输入核心API地址",
    },
  },
  {
    field: "coreConfig.token",
    label: "核心Token",
    component: "InputPassword",
    required: false,
    bottomHelpMessage: "晶灵核心可选访问Token",
    componentProps: {
      placeholder: "请输入核心Token",
    },
  },

  // auth.json - 认证配置
  {
    label: "入群验证",
    component: "SOFT_GROUP_BEGIN",
  },
  {
    field: "auth.url",
    label: "手性碳验证API地址",
    component: "Input",
    bottomHelpMessage: "验证基础api，有需求可自建",
    componentProps: {
      placeholder: "请输入验证API地址",
    },
  },
  {
    field: "auth.default.enable",
    label: "全局启用验证",
    component: "Switch",
    bottomHelpMessage: "是否在全部群聊启用验证",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "auth.default.carbon.enable",
    label: "手性碳验证",
    component: "Switch",
    bottomHelpMessage: "是否默认启用手性碳验证,关闭则为数字验证",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "auth.default.carbon.hint",
    label: "手性碳验证提示",
    component: "Switch",
    bottomHelpMessage: "是否显示手性碳验证提示(使用星号标注手性碳位置)",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "auth.default.carbon.hard-mode",
    label: "手性碳验证困难模式",
    component: "Switch",
    bottomHelpMessage: "是否启用手性碳验证困难模式(困难模式下需要找出全部手性碳)",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "auth.default.timeout",
    label: "验证超时时间",
    component: "InputNumber",
    bottomHelpMessage: "验证超时时间(秒)",
    componentProps: {
      min: 30,
      max: 600,
      step: 10,
      placeholder: "请输入验证超时时间(秒)",
    },
  },
  {
    field: "auth.default.recall",
    label: "撤回未认证消息",
    component: "Switch",
    bottomHelpMessage: "是否撤回验证通过前用户发送的消息",
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: "auth.default.frequency",
    label: "最大验证次数",
    component: "InputNumber",
    bottomHelpMessage: "验证的最大次数，超过视为失败",
    componentProps: {
      min: 1,
      max: 24,
      step: 1,
      placeholder: "请输入最大验证次数",
    },
  },

  // 60s.json - 60s新闻配置
  {
    label: "60s新闻",
    component: "SOFT_GROUP_BEGIN",
  },
  {
    field: "60s.url",
    label: "60s新闻API",
    component: "Input",
    bottomHelpMessage: "60s新闻的API地址",
    required: true,
    componentProps: {
      placeholder: "请输入60s新闻API地址",
    },
  },

  // music.json - 音乐配置
  {
    label: "点歌配置",
    component: "SOFT_GROUP_BEGIN",
  },
  {
    field: "music.url",
    label: "音乐API地址",
    component: "Input",
    bottomHelpMessage: "音乐API地址",
    required: true,
    componentProps: {
      placeholder: "请输入音乐API地址",
    },
  },
  {
    field: "music.username",
    label: "音乐API用户名",
    component: "Input",
    bottomHelpMessage: "音乐API用户名",
    componentProps: {
      placeholder: "请输入音乐API用户名",
    },
  },
  {
    field: "music.password",
    label: "音乐API密码",
    component: "InputPassword",
    bottomHelpMessage: "音乐API密码",
    componentProps: {
      placeholder: "请输入音乐API密码",
    },
  },

  // poke.json - 戳一戳配置
  {
    label: "戳一戳",
    component: "SOFT_GROUP_BEGIN",
  },
  {
    field: "poke.replyPoke",
    label: "戳一戳回戳概率",
    component: "InputNumber",
    bottomHelpMessage: "戳一戳回戳概率",
    componentProps: {
      min: 0,
      max: 1,
      step: 0.1,
      placeholder: "请输入回戳概率",
    },
  },

  // profile.json - 用户资料配置
  {
    label: "机器人资料",
    component: "SOFT_GROUP_BEGIN",
  },
  {
    field: "profile.nickName",
    label: "机器人昵称",
    component: "Input",
    bottomHelpMessage: "机器人的昵称",
    componentProps: {
      placeholder: "请输入机器人昵称",
    },
  },
];

export default guobaSchema;
