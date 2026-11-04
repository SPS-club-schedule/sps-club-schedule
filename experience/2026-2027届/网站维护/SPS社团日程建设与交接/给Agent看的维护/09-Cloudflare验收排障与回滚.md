# Cloudflare 验收排障与回滚

本篇给出发布后检查、分层排障和恢复时的判断顺序。示例使用保留域名，不会暴露真实账号、私人路径或凭据；执行时在获授权的本机环境替换地址。范围基于 2026 年 11 月 4 日项目代码。

## 准备一份最小验证记录

记录代码提交、改动层、前后端是否部署、检查时间与时区、结果及异常摘要。实际 Worker 版本、账号 ID 和恢复书签如需保存，放到受控运维记录；公开经验只保留解释问题所需的信息。

只读健康检查先行，真实业务写入另按当前任务范围执行。不要为了排错注册假生产账号、撤销真实成员会话或清空任务。

## 一 按请求路径逐层检查

在本机设置已核对的地址。以下三项均为示例值：

```sh
SPS_CHECK_ORIGIN='https://club.example.org'
SPS_CHECK_GATEWAY='https://api.example.org'
SPS_CHECK_UPSTREAM='https://origin-api.example.net'
```

分别检查上游与网关：

```sh
curl --silent --show-error --fail --max-time 20 -H "Origin: $SPS_CHECK_ORIGIN" "$SPS_CHECK_UPSTREAM/health"
curl --silent --show-error --fail --max-time 20 -H "Origin: $SPS_CHECK_ORIGIN" "$SPS_CHECK_GATEWAY/health"
```

health 主要证明该条路由可响应。本项目原 API 的 health 在进入 Durable Object 之前就返回，**不能用它证明数据库、账号或同步队列都正常**。要补充公开档案读取、获授权会话下的任务读取和对应功能检查。

## 二 核对 CORS 与错误行为

预检不带成员 token：

```sh
curl --silent --show-error --max-time 20 -X OPTIONS -D - -o /dev/null -H "Origin: $SPS_CHECK_ORIGIN" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: Content-Type,Authorization' "$SPS_CHECK_GATEWAY/api"
```

应有 204，允许来源精确等于实际网页 Origin，允许所需方法与 Content-Type、Authorization。网关和上游都要一致；CORS 只控制浏览器跨源访问，不代替认证。

再用不含凭据的请求确认未登录不会获得私有任务：

```sh
curl --silent --show-error --max-time 20 -X POST -H "Origin: $SPS_CHECK_ORIGIN" -H 'Content-Type: application/json' --data '{"action":"bootstrap"}' "$SPS_CHECK_GATEWAY/api"
```

当前基线应返回认证错误，不应出现私有成员或任务数据。为了观察预期失败响应，这条命令未使用 --fail。公开档案可单独检查：

```sh
curl --silent --show-error --fail --max-time 20 -H "Origin: $SPS_CHECK_ORIGIN" "$SPS_CHECK_GATEWAY/experience"
```

网页档案包装为 `{ok:true,data:{entries,...}}`，仓库静态索引包装为 `{entries}`。合法空数组、网络失败和解析错误是不同结果。

回归测试还应验证错误 Origin、未允许路径、非法方法、查询参数、上游 HTML 与重定向。不要把网关放宽成任意代理来解决某个 404。

## 三 按层理解常见异常

| 现象 | 优先核对 | 不能据此认定 |
| --- | --- | --- |
| 403 | 请求 Origin、账号资源权限，以及响应来自平台还是应用 | 一定是密码错误 |
| 401 | 会话是否存在和有效 | 数据库损坏 |
| 网关 404 | 路由白名单、查询参数、路径格式 | 文件一定被删除 |
| 网关 405 | 方法与路径组合 | 服务已经下线 |
| 网关 503 | 网关签名 Secret 是否配置 | 需要重建数据库 |
| 网关 502 | 固定上游是否可达、超时、重定向或非 JSON 响应 | 只要刷新前端就能修好 |
| 429 | 应用限流、平台限制、代理后的来源识别 | 立刻购买套餐就能解决 |
| health 正常但业务失败 | Durable Object、授权、配置绑定、实际请求 | 后端已全面健康 |
| 新功能入口出现但请求 404 | 后端和网关发布是否滞后 | 前端代码一定错误 |
| 账号或任务突然像是空的 | 社团选择、账号目标、对象名和绑定 | 应初始化新数据库 |

授权命令失败时，先核对 CLI 会话和目标资源；本地 OAuth 回调失败则检查运行 Wrangler 的机器与浏览器能否互相到达。网络诊断可记录结果和错误类型，不导出个人代理设置或认证回调完整地址。

## 四 验证预约同步真正完成

受服务密钥保护的原 API `GET /integrations/booking` 可读取 configured 与同步状态。它不经公众网关，凭据只由受控调用工具传入，不把 Bearer 值写进命令示例、日志或截图。

| 字段 | 含义 |
| --- | --- |
| desired | 希望发送到预约服务的最新源版本 |
| delivered | 已确认送达的源版本 |
| attempts | 当前失败重试计数 |
| synced_at | 最近成功确认的时间 |

`delivered >= desired` 表示当前待发送版本已确认，不代表预约界面每一项显示都核对完成。还要检查具体活动时段、地点、来源，以及旧手动预约和课程。

首次补齐用受保护的 POST 管理入口，只安排后台 reconcile；返回 queued 说明已排队，不能报告同步完成。alarm 将发送快照，只有接收端返回合法且足够新的 sourceVersion 才确认；失败会退避重试。持续失败先核对双方密钥、精确社团 ID、固定 URL 与响应格式，不能反复创建同一活动。

## 五 验证文档与前端自动更新

纯文档发布应读正式 experience-index.json，检查条目路径、大小、SHA-256，再下载正文比较。版本页与资源加载正常后，从社团经验实际打开目录和在线阅读。

自动更新会避让编辑、上传、保存和教程草稿。页面暂缓更新时，先保留未完成内容；不能为完成验收强行刷新用户的草稿。旧版页面没有检测器时，重新打开一次页面与已安装检测器后的更新行为也要区分。

## 六 回滚代码前选择目标层

| 故障范围 | 回退对象 | 仍需核对 |
| --- | --- | --- |
| 静态页面或档案 | Pages 对应源代码版本或修复提交 | 新旧 API 兼容、构建变量、线上索引 |
| 网关路由或转发 | 网关 Worker 已验证版本 | 上游、Secret、Origin 和域名绑定 |
| 原 API 实现 | 原 API Worker 已验证版本 | 当前数据结构与绑定仍兼容 |
| 域名入口 | 经确认可用的原 API 入口及前端构建配置 | CORS、CSP、访问性 |
| 业务数据误写 | 针对数据的独立恢复方案 | 影响范围、恢复点、后续新写入 |

先私下列出部署，核对旧版本与当前绑定：

```sh
npx wrangler deployments list --config wrangler.jsonc
npx wrangler deployments status --config wrangler.jsonc
npx wrangler versions view '<verified-version-id>' --config wrangler.jsonc
```

只有确定要回退原 API 后才执行：

```sh
npx wrangler rollback '<verified-version-id>' --config wrangler.jsonc --message 'Restore verified API version'
```

网关回退使用其配置和属于网关自己的版本 ID，不把两个 Worker 的版本混用。rollback 会立即创建部署；它不恢复所连接资源中的数据，且 Durable Object 生命周期迁移等变化可能阻止直接回滚。目标版本不可用时，应评估在当前配置下重新部署兼容代码，不能删绑定来强行回退。[官方回滚限制](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

回退后重复健康、业务、档案与同步检查。不要删除“看起来新增加”的表或字段作为清理步骤。

## 七 数据恢复必须考虑整个对象

本项目当前以一个 Durable Object 承载多个社团及相关记录。对象级恢复可能同时影响账号、会话、任务、完成记录、网页档案、管理记录及同步状态，并不是只恢复一项任务。

SQLite Durable Object 的 PITR 针对整个数据库，使用书签；官方当前文档说明可恢复最近 30 天，且本地开发不支持该历史恢复。书签恢复在下次对象重启生效，并返回用于撤销这次恢复的书签。[官方 PITR 说明](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api)

因此恢复前需要确定误写时间、影响范围和当前状态保存方式，协调期间写入，核对恢复后的账号及任务。当前项目没有公开的 PITR 操作接口，不能在生产临时暴露一个匿名“恢复数据库”路由。

对象回退还可能让预约发送版本落后于接收端，或使旧会话记录重新出现。恢复方案要单独处理外部同步版本、会话撤销及新数据取舍。不能直接把旧数据库再全量发送，假定另一服务会接受较旧版本。此处记录的是需评估的恢复流程，未把它描述成已经执行过的演练。

源码 Git、Pages 产物和平台历史恢复各有用途；源码仓库不是成员数据备份。包含真实数据的备份不能放入公开经验档案。

## 八 可公开的交接回执模板

```text
检查时间与时区：
变更范围：原 API / 网关 / 前端 / 文档 / 同步
代码版本：
授权目标核对：通过 / 待处理（不附账号列表）
部署结果：逐层记录
检查结果：health、CORS、认证、业务、档案、同步
现有数据保持：已核对的范围
回退方案及当前可用性：
未解决事项：
敏感信息：原始日志和运行配置留在受控环境
```

回执不附实际密钥、个人邮箱、账号 ID、恢复书签、私有资源清单、用户 IP 或完整错误请求体。若要截图，用经过脱敏的结果视图，避免浏览器其他标签页和账号菜单。

[配置与发布手册](https://sps-club-schedule.github.io/sps-club-schedule/#/experience?folder=2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99Agent%E7%9C%8B%E7%9A%84%E7%BB%B4%E6%8A%A4&document=repo%3A2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99Agent%E7%9C%8B%E7%9A%84%E7%BB%B4%E6%8A%A4%2F08-Cloudflare%E9%85%8D%E7%BD%AE%E4%B8%8E%E5%8F%91%E5%B8%83%E6%93%8D%E4%BD%9C%E6%89%8B%E5%86%8C.md) · [整体讲解](https://sps-club-schedule.github.io/sps-club-schedule/#/experience?folder=2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99%E6%88%90%E5%91%98%E7%9C%8B%E7%9A%84%E6%B5%81%E7%A8%8B&document=repo%3A2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99%E6%88%90%E5%91%98%E7%9C%8B%E7%9A%84%E6%B5%81%E7%A8%8B%2F08-Cloudflare%E5%B7%A5%E4%BD%9C%E6%B5%81%E8%AE%B2%E8%A7%A3.md) · [返回阅读导航](https://sps-club-schedule.github.io/sps-club-schedule/#/experience?folder=2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5&document=repo%3A2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F00-%E9%98%85%E8%AF%BB%E5%AF%BC%E8%88%AA%E4%B8%8E%E7%89%88%E6%9C%AC%E8%AF%B4%E6%98%8E.md)
