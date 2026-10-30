# SPS 社团日程：GitHub Pages 与 Cloudflare

2026-10-29。独立项目源码：`/Users/grassman_number/Projects/sps-club-schedule`。旧微信小程序源码保留在 `/Users/grassman_number/AI/ai_works/sps-club-miniprogram`，不再作为本项目的运行入口。

已发布前端：<https://sps-club-schedule.github.io/sps-club-schedule/>。API 入口：<https://sps-schedule.folderrewind.top>（Leafuke 的 Worker 网关）。原 API 与数据库保留在 <https://sps-club-api.sysu-physics-clubs.workers.dev>，详见 [网关配置与回滚](cloudflare-gateway.md)。仓库：<https://github.com/SPS-club-schedule/sps-club-schedule>。当前 AI 工作区的 `farawayshore/AI-new-` 仓库没有用于本应用的 Pages 部署。

## Cloudflare 后端

`wrangler.jsonc` 定义 Worker `sps-club-api` 和 SQLite Durable Object `ClubService`。首次部署自动创建对象命名空间与数据库结构，无需另租服务器或手动维护数据库。不要修改 `migrations` 的既有标签、类名或 `sps-club-service-v1` 对象名；这些标识关系到现有数据的位置。

```sh
npm ci
npx wrangler login
npm run worker:deploy
# 网关单独部署：
npm run gateway:deploy
```

部署前将 `ALLOWED_ORIGINS` 设为实际网页的完整源，例如 `https://sps-club-schedule.github.io`；不带仓库路径、不带尾斜杠。多个源以逗号分隔。正式环境不要加入任意通配源。本地 `.dev.vars` 只用于本机开发，不能上传到仓库。

`REGISTRATION_OPEN=true` 允许通过邀请码注册，或注册并创建自己的社团。注册不会获得其他社团的数据；访问每项任务时仍检查社团成员身份。设置为 `false` 可以暂停新账号注册，不影响已有账号登录。

Worker 使用无第三方 Cookie 的 Bearer 会话，适用于 GitHub Pages 与 `workers.dev` 分属不同站点的情况。会话不出现在 URL 中；邀请链接在 URL fragment 内，不会作为页面访问路径发送给静态站点服务器。

## GitHub Pages 前端

使用独立仓库 `sps-club-schedule`，仅上传本项目源码。不要上传其他工作区、`.wrangler/`、`.dev.vars` 或本地账号数据。公开的是网页与代码，社团数据保存在后端，登录并通过成员权限检查后才能读取。

在仓库 Settings → Pages 中选择 GitHub Actions。在 Settings → Secrets and variables → Actions 的 Variables 中设置 `API_BASE_URL`，当前值为 `https://sps-schedule.folderrewind.top`。

推送 `main` 后，工作流依次安装依赖、运行领域/同步/界面测试、Workers 集成测试和网关测试、构建静态网页并部署。前端使用相对资源路径与 hash 路由，适用于 `https://<用户名>.github.io/sps-club-schedule/` 项目路径，刷新任务详情不会触发 GitHub Pages 404。

本机针对正式后端构建：

```sh
API_BASE_URL=https://实际Worker地址 npm run build
```

`dist/` 只包含 HTML、JavaScript、CSS、图标和公开的 API 地址，没有密码、会话或数据库内容。GitHub Actions 无需 Cloudflare 密钥；后端通过已登录的 Wrangler 独立部署。

## 首次正式使用

负责人在网页“注册并加入”里选择“创建社团”，填写自己的用户名、密码、称呼和社团名，保存恢复码。在“社团成员”复制邀请链接发给成员；成员各自设置账号密码。

不要将本地测试账号或恢复码当成正式账号。演示和本地联调数据没有迁移到线上；正式数据库从空社团列表开始。

## 运维与限制

数据库的 `records` 表保存社团、成员、任务和邀请，`accounts` 保存密码散列，`sessions` 保存令牌摘要与过期时间。不得直接编辑任务而不更新社团同步版本。归档保留删除标记，不物理清除。

发布新后端前执行测试并检查配置差异。Cloudflare SQLite Durable Objects 提供平台的时间点恢复能力；执行恢复前需确认恢复范围并保存当前状态。源码包不是线上数据备份。没有购买套餐或设置自动升级的脚本；实际额度和费用以账号控制台为准。

官方资料：[Durable Object SQLite 存储](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)、[Workers Node.js crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)、[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 管理功能的存储兼容性

成员角色新增 `admin`，现有 `owner` 自动拥有后台权限。首次启动仅增加 `account_versions`（账号变更版本）、`account_resets`（一次性重设令牌摘要、有效期及授权来源）、`admin_audit`（不含凭据的操作记录）三张表；不修改原账号字段、Durable Object 名称或绑定，不复制或重建生产数据。密码重设继续走现有 `/auth/recover`，因此无需变更域名网关。部署时先更新原 API Worker，再发布 Pages 前端。回滚旧前端和 Worker 不会删除新增表或已有账号，但旧版本没有管理功能。

部门功能在现有 JSON 记录中新增成员 `department`、社团 `departmentInviteHashes` 和邀请 `department` 字段，不增加 SQL 表或更换数据库位置。首次读取邀请码时，在同一个事务中生成缺少的三个部门邀请，并更新邀请同步版本；通用邀请码保持有效。旧成员缺少部门字段时按未分配读取；旧版管理客户端省略部门字段时保留当前部门。部署顺序仍为先 Worker、后 Pages。若回滚到不支持部门的旧 Worker，部门邀请将不可用，应同时恢复旧前端并使用原通用邀请码。
