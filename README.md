# SPS 社团日程 · 网页版

中文社团任务协作应用。GitHub Pages 托管静态网页，Cloudflare Workers 提供 API，SQLite-backed Durable Object 持久化账号、社团、任务及完成记录。不再依赖微信小程序、AppID 或腾讯云开发。

API 入口使用 Leafuke 提供的 `https://sps-schedule.folderrewind.top`，经网关访问原有数据库；配置与回滚见 [域名网关说明](docs/cloudflare-gateway.md)。

正式网站：[SPS 社团日程](https://sps-club-schedule.github.io/sps-club-schedule/)。独立仓库：[SPS-club-schedule/sps-club-schedule](https://github.com/SPS-club-schedule/sps-club-schedule)。本机独立项目目录：`/Users/grassman_number/Projects/sps-club-schedule`。

沿用原版的绿色配色、任务看板、逐人/协作完成、成员进度、截止时间、搜索和个人待办。所有社员可以发布任务；发布者与社团创建者管理任务。任务参与名单发布后固定，归档保留完成记录。

## 使用

第一次使用：选择“注册并加入”。已有社团成员填写邀请码；社团负责人选择“创建社团”。用户名使用3—30位英文字母、数字或下划线，密码至少10个字符。社团称呼可用中文。保存仅显示一次的账号恢复码，然后开始使用。

成员页可以复制邀请码或分享邀请链接。新用户通过邀请注册；已登录用户通过邀请加入。更换邀请码会使旧链接失效，不影响已有成员。登录会话仅保存在当前浏览器标签页的 `sessionStorage`，关闭标签页后需要重新登录；服务端会话最长7天。退出登录会立即撤销当前会话，密码恢复会撤销所有旧会话并更换恢复码。

忘记密码时，在登录页选择“用恢复码找回”。不依赖邮件服务。若同时丢失密码和恢复码，当前版本不提供自动找回功能。

## 本地运行

需要 Node.js 22 或更新版本。

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run worker:dev
```

另一个终端：

```sh
npm run build
npm run preview
```

网页位于 `http://127.0.0.1:4175`，本地 Worker 位于 `http://127.0.0.1:8787`。本地数据保存在忽略的 `.wrangler/` 内，和正式环境完全分开。前端所有请求实际经过本地 Cloudflare runtime 与 SQLite，不是内存演示。旧微信演示数据不会自动上传。

## 同步

前台15→30→60秒自适应检查；只传回有变化的任务、成员和归档标记。自己的操作在服务器确认后直接更新。切到后台或离线停止自动请求，回到前台、恢复联网和手动刷新立即检查。读错误保留上次确认内容，最多退避120秒；身份失效清空缓存并回到登录页。编辑草稿不被定时读取覆盖。

身份来自服务端会话，不接受客户端伪造的成员标识。共享领域逻辑在 SQLite 事务里写入任务和社团版本号；Durable Object 串行处理异步领域操作，避免同时打勾丢失数据。当前面向小型社团部署，使用单个 Durable Object 保存所有社团，各社团仍逐请求验证成员权限；大规模多租户服务需进一步拆分和分页。

## 结构

- `client/`：原生 HTML/CSS/JavaScript 网页，没有微信运行时或框架依赖。
- `shared/`：任务规则、时间格式、增量同步调度器。
- `server/`：Cloudflare Worker、SQLite 适配器、账号与会话。
- `scripts/`：静态站点构建与本地预览。
- `.github/workflows/pages.yml`：测试、构建和部署 GitHub Pages。
- `qa/verification.md`：本次验证范围。

部署说明：[GitHub Pages 与 Cloudflare 接入](docs/deployment.md)。本项目已从原 AI 工作区移出，部署工作流只操作这个独立仓库。

## 检查

```sh
npm test
npm run test:worker
npm run build
npm audit
```

28项领域/同步测试和10项 Workers runtime 集成测试。集成测试覆盖 SQLite 事务回滚、并发、账号隔离、退出撤销、恢复码轮换、限流、CORS、超长请求和持久化重启。测试运行时与 Wrangler 锁定同一版 Miniflare；`convertV4MiniflareOptions` 只用于测试配置兼容，不在生产 Worker 中。

密码用原生 scrypt（N=32768，r=8，p=3，随机盐）散列。随机会话令牌和恢复码仅保存 SHA-256 摘要；客户端只持有当前会话令牌。没有第三方统计、用户内容日志、外部字体或邮件依赖。生产运行代码没有 npm 第三方运行时依赖；Cloudflare 内置的 `node:crypto` 提供密码算法。

当前不含推送通知、附件、评论、成员移除和归档恢复界面。截止时间到达不会主动发微信提醒。Cloudflare 和 GitHub Pages 的网络可达性取决于成员所在网络，应使用社团成员的实际设备验证。
