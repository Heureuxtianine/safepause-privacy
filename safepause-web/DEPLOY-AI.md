# 部署国产模型语音对话

## 当前公网网址为什么不能直接操作手机

腾讯云静态托管只运行 index.html。它没有执行 server.mjs，也没有手机系统权限。选择设备类型只改变适配建议；并非配对。PPT 中 DroiClaw 的真机能力属于原设备应用，不能自动转移给浏览器。

## 语音助手的两种可用状态

- **未配置国产模型**：01 页仍可调用手机或浏览器的语音识别，将识别文字交给本地 SafePause 规则，并用系统中文朗读回复。这条路径不上传录音，也不需要模型密钥；它适合先在 vivo V2527A 上验证“说话、识别、回复、朗读”闭环。
- **配置豆包、腾讯混元或通义千问**：用户勾选本次文字处理授权后，转写文字才会发送到受控 SafePause 服务，由服务端调用所选国产模型，再把回复返回手机朗读。若采用录音转写模式，还要单独勾选音频上传授权。每轮都由用户点击开始，不会后台持续收音。

豆包 App 和元宝 App 不能被网页直接嵌入成语音 API；本项目使用火山方舟 API 或腾讯混元 OpenAI 兼容 API。把 Skill 导入豆包/元宝消费端也不会自动取得短信、电话或网页控制权限。

## 本次交付

- 前端默认录音输入；浏览器实时识别为可选路径，异常退出不再弹“语音已停止”。
- /api/transcribe：经单独语音授权上传 WAV 给阿里云百炼 Qwen3-ASR，返回文字后可交给选定模型。
- /api/chat：加载 agent-skill.md 和已发现的 MCP 工具，调用用户在网页中选择、且已在服务端配置的国产模型，返回回复或单项待确认工具建议。
- 模型建议不会直接执行，页面参数核对后仍需 /api/prepare 和 /api/execute 的一次性确认。
- 用户勾选文字处理和语音上传两类会话授权后，可以按轮录音、自动转写、调用所选模型并由手机朗读。每轮仍由用户点击开始，不会后台持续收音。
- 对话历史只暂存在当前页面并随本次请求发送；取消文字授权会清除页面内暂存上下文。服务端没有历史记录数据库。

## 先配置模型服务

先在服务端配置一个或多个模型 API Key。豆包与腾讯混元可以直接作为对话模型；通义千问也可使用。网页只会列出服务端已配置的选项，选择只影响本次会话路由，厂商 Key 不会下发到浏览器或 APK。服务端加载已打包的 `agent-skill.md`，因此模型得到 SafePause 的规则和边界。

需要运行 Node.js 20+ 的容器或服务器，CloudBase 静态托管不能运行本后端。在服务器设置环境变量：

| 变量 | 用途 |
| --- | --- |
| SAFEPAUSE_HOST | 容器内用 0.0.0.0 |
| PORT | 默认 4173，按容器配置 |
| SAFEPAUSE_ACCESS_KEY | 强随机演示访问密钥 |
| SAFEPAUSE_ALLOWED_ORIGINS | https://safepause-d2gvkokn8b7153e15-1502903039.tcloudbaseapp.com |
| DASHSCOPE_API_KEY | 百炼中国内地 API Key，仅在服务端 |
| SAFEPAUSE_DASHSCOPE_ENDPOINT | 可选；百炼工作空间专属 HTTPS Chat Completions 地址，须与 API Key 所属地域一致 |
| SAFEPAUSE_AI_PROVIDER | 默认模型：`qwen`、`doubao` 或 `hunyuan`；网页可在已配置提供商间切换 |
| SAFEPAUSE_QWEN_MODEL | 可选，通义千问模型名，默认 `qwen-plus` |
| ARK_API_KEY | 使用豆包/火山方舟时的 API Key，仅在服务端 |
| SAFEPAUSE_DOUBAO_ENDPOINT | 可选；默认 `https://ark.cn-beijing.volces.com/api/v3/chat/completions` |
| SAFEPAUSE_DOUBAO_MODEL | 可选；填写火山方舟控制台中已开通的模型或推理接入点 ID |
| HUNYUAN_API_KEY | 使用腾讯混元 API 时的 API Key，仅在服务端 |
| SAFEPAUSE_HUNYUAN_ENDPOINT | 可选；默认 `https://api.hunyuan.cloud.tencent.com/v1/chat/completions` |
| SAFEPAUSE_HUNYUAN_MODEL | 可选，默认 `hunyuan-turbos-latest` |
| SAFEPAUSE_CHAT_MODEL | 旧版通用模型变量；建议改用各提供商单独的模型变量 |
| SAFEPAUSE_ASR_MODEL | 可选，默认 qwen3-asr-flash |
| SAFEPAUSE_MCP_URL | 实际手机 MCP Streamable HTTP 地址，没有就不设置 |
| SAFEPAUSE_MCP_TOKEN | 实际服务要求的令牌，按需设置 |

运行 node server.mjs，将它通过 HTTPS 网关提供访问。腾讯云静态网站不会执行这个 Node 服务；把 `SafePause-standalone.html` 部署为静态网页入口，用户在“设备调用”填入 SafePause 服务 HTTPS 根地址和 `SAFEPAUSE_ACCESS_KEY`，并在服务端把静态网页域名加入 `SAFEPAUSE_ALLOWED_ORIGINS`。Android App 顶部点击“连接”→“配置安心小助手”，填写同一服务根地址和访问密钥。不要填静态网站地址或厂商模型 API Key。Skill 内容已打包在服务端 `agent-skill.md`；厂商 Key 不进入 APK。手机上的服务访问密钥只在 App 本次运行期间保留，重启后需重新填写。对话前同意文字处理；录音转写另须同意录音上传。模型提供设备操作建议后，仍要页面核对和手机原生确认。

### 选择豆包

```powershell
$env:SAFEPAUSE_AI_PROVIDER = 'doubao'
$env:ARK_API_KEY = '你的火山方舟 API Key'
$env:SAFEPAUSE_CHAT_MODEL = '你的豆包模型或推理接入点 ID'
node server.mjs
```

火山方舟提供 OpenAI 兼容 Chat Completions 接口；用户在页面选择“豆包（火山方舟）”后，SafePause 服务端使用此 Key 处理对话。录音转写仍使用单独配置的百炼 Qwen ASR。豆包 App 本身不能被网页直接当作系统语音 API 调用；接入的是火山方舟开发者接口，不是控制或嵌入豆包 App。

百炼工作空间专属接口可能要求地域对应的域名；可在服务端用 `SAFEPAUSE_DASHSCOPE_ENDPOINT` 指定官方给出的 Chat Completions 完整地址。当前默认的旧版内地地址仅用于尚可使用该入口的账号，若返回 401/404 需核对工作空间和地域。不得把任意第三方域名设为模型端点。

当前后端面向一台设备和受限团队演示；尚无多用户登录、每用户设备隔离、访问配额和审计持久化，不适合开放给陌生人。不能把一个手机的网关密钥作为全体用户共用的公开账号。

### 选择腾讯混元（元宝同源模型能力）

元宝手机 App 不能被网页直接当成语音 API，也不能通过“导入 Skill”自动变成网页后端。若希望使用腾讯生态的国产模型，请在腾讯混元控制台创建 API Key，并只在 SafePause 服务端配置：

```powershell
$env:SAFEPAUSE_AI_PROVIDER = 'hunyuan'
$env:HUNYUAN_API_KEY = '你的腾讯混元 API Key'
$env:SAFEPAUSE_CHAT_MODEL = 'hunyuan-turbos-latest'
node server.mjs
```

用户可在页面选择“腾讯混元（元宝同源模型）”。手机说话后，系统语音识别或受控录音转写得到文字，服务端把文字和 SafePause Skill 交给混元生成回复，再由手机中文语音引擎朗读。模型只提出短信、电话或提醒建议，仍必须由本人核对并在手机确认。该接入调用腾讯混元 API，不会调用或嵌入元宝消费端 App，也不会自动加载元宝 App 中的自定义 Skill。

腾讯混元的 OpenAI 兼容接口地址是 `https://api.hunyuan.cloud.tencent.com/v1/chat/completions`；不要把 API Key 填进网页、静态托管配置或手机端。录音转写仍独立使用百炼 Qwen ASR，或选择手机/浏览器语音识别，此时识别服务由操作系统或浏览器提供；网页不会读取蜂窝通话音频。

## 自动识别新短信的下一步

需要实际手机应用或厂商服务在系统允许范围内接收短信事件，对本机完成本地过滤，按用户选定的范围调用识别流程。MCP 只解决工具通信，不授予短信接收权限。本版尚未实现原生订阅或轮询。DroiClaw 是否提供远程接口、事件订阅必须查其实际文档；当前没有地址和协议，不猜测。

不同系统分别接入：Android 的短信角色/敏感权限及后台策略需真机验证；鸿蒙需要对应版本的原生接口；iPhone 无可用授权接口时保留本人选择和系统短信/拨号页面。发送动作需既定用途、明确接收人和本次确认。短信送达需真实设备返回或回读，不能凭模型回复声称成功。

## 验证边界

离线测试覆盖音频授权、未知模型工具拒绝、待确认建议、浏览器语音异常和 MCP 协议。尚未调用付费百炼接口，也未验证跨品牌设备操作。需补充真实账号、受控 HTTPS 后端和手机服务后完成端到端验收。

语音接口格式依据官方文档：https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide 。云端处理的数据安全、留存及计费条款由项目方在开通服务时确认并告知用户。
