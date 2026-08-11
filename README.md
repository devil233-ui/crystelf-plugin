# crystelf-plugin
> 多功能群娱乐插件

## 安装方法
- 使用 Github  

    ```bash
    git clone --depth=1 https://github.com/devil233-ui/crystelf-plugin ./plugins/crystelf-plugin
    ```
### 安装依赖  
在`Yunzai`根目录下执行:  
- npm `npm install`
- pnpm `pnpm install`

## 可用功能  
> 某些功能可能会与其他插件发生冲突,在config中调整对应功能关闭即可
<details>
<summary>60s</summary>

- 命令: `60s` 或 `早报`  
![60s.png](resources/readme/60s.png)
</details>
<details>
<summary>更好的<small><del>手性碳</del></small>数字验证</summary>

> bot需要为群管理及以上,操作者需为主人或群管理员
- `#开启验证` 在本群开启验证,默认验证模式为数字验证(100以内加减法)
- `#关闭验证` 在本群关闭验证
- `#切换验证模式` 在数字验证模式和手性碳验证模式之间切换
- `#重新验证@某人` 让这个人重新验证一次  
- `#绕过验证@某人` 你不用再验证了  
- `#设置验证(提示|困难)模式(开启|关闭)` 提示模式开启时,会在图上用`*`标记手性碳位置;困难模式开启时,新人需要回答出全部手性碳位置而不是默认的只需要回答出一个位置
- `#设置验证次数+次数` 最大验证次数
- `#设置撤回(开启|关闭)` 是否撤回错误答案  
![tan.png](resources/readme/tan.png)
</details>
<details>
<summary>自定义加群欢迎</summary>

> 操作者需为主人或群管理员
- `#设置欢迎文案+欢迎词` 在某个群替换默认欢迎文案为欢迎词
- `#设置欢迎图片+图片` 或 `#设置欢迎图片` + 引用图片 在某个群的欢迎词后面加一张图片/表情包
- `#查看欢迎` 查看当前群欢迎词
- `#清除欢迎` 清楚当前群欢迎词  
![welcome.png](resources/readme/welcome.png)

</details>
<details>
<summary>表情回复</summary>

- 开启后bot会监听所有群聊中用户消息中存在的emoji并贴上表情
- `#回应+emoji` 查看当前emoji对应类型及id

</details>
<details>
<summary>戳一戳功能</summary>

- 开启本功能后戳一戳bot会调用晶灵核心的戳一戳词库进行回复
</details>
<details>
<summary>rss订阅及推送</summary>

- `rss添加+订阅地址` 添加rss订阅源到该群聊,bot会定时检查该源是否更新并推送
- `rss移除+id` 在本群移除某个订阅
- `rss拉取+订阅地址` 测试拉取某个rss源
- 全局去重默认保留500条已处理链接,可通过`config/config.json`中的`maxRssDedupe`调整
- RSS轮询规则可通过`config/config.json`中的`rssCron`调整，默认`1/5,2/5 * * * *`，即每小时在`01、02、06、07、11、12...`分检查；修改后需重启插件生效
- 注意：`1,2/5 * * * *`实际表示`01、02、07、12...`分，不是每个五分钟周期连续检查两次

需要登录才能访问的RSS可在`config/rssAuth.json`中按域名配置Cookie。实际配置文件已被Git忽略,请勿把Cookie提交到仓库。以下示例让`esa.zlb.ink`复用`eo.zlb.ink`的认证信息:

```json
{
  "aliases": {
    "esa.zlb.ink": "eo.zlb.ink"
  },
  "sites": {
    "eo.zlb.ink": {
      "enabled": true,
      "cookie": "在此填写浏览器请求中的完整Cookie",
      "userAgent": "Mozilla/5.0 (compatible; crystelf-plugin RSS reader)"
    }
  }
}
```

</details>
<details>
<summary>早晚安</summary>

- 在群里正常发送早晚安时,插件会调用晶灵核心的早晚安 API 获取文案进行回复
- `早安`
- `晚安`

</details>
<details>
<summary>点歌功能</summary>

- 使用[hifi公共音源库](https://github.com/sachinsenal0x64/hifi)提供服务,
- 由于音源位于海外,大陆连接下载音乐时可能遇到缓慢问题,考虑优化网络环境
- 由于海外音源,搜歌时考虑使用繁体中文,英文等进行搜索以处理搜索不到的情况
- 默认下载flac/CD无损级音乐,可在配置文件调整为mp3音质或直接通过语音发送
- ~~可以听周杰伦~~
- `版权点歌xxx`
- `#听1`
- `#听夜曲`

> 直接#听+歌曲名可能播放错误的歌曲

</details>

## 插件配置  

## **本插件已适配锅巴,请务必使用锅巴进行插件配置**  

实际配置位于插件目录下的 `config/*.json`，可通过锅巴或手动修改；`config/default/` 仅保存默认模板。

## 关于晶灵核心  
晶灵核心是一个开源的api服务,使用nestjs框架编写,本插件的戳一戳和早晚安功能依赖于晶灵核心.
其中,全部功能都可以使用官方提供的api进行操作,如果部分地区被墙或速度过慢,可以参考教程自行部署晶灵核心.  
晶灵核心及文案等数据均开源,但表情数据及图片为闭源不公开,如自行部署需要考虑表情问题(如自行收集表情包存于相关目录下).  
自行搭建请前往[晶灵核心仓库](https://github.com/crystelf/crystelf-core)

## 关于兼容性
| 框架/适配器          | 是否适配   |
|-----------------|--------|
| TRSS-Yunzai     | 完全适配   |
| Miao-Yunzai     | 可能出现问题 |
| Onebot-Napcat   | 完全适配   |
| Onebot-Lgr      | 完全适配   |
| Onebot-LLTwoBot | 部分适配   |
| ICQQ            | 可能出现问题 |