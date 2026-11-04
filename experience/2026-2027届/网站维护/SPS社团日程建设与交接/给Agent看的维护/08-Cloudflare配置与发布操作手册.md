# Cloudflare 配置与发布操作手册

这篇记录本项目现有的双 Worker、Durable Object 与 GitHub Pages 发布路径。核对日期为 2026 年 11 月 4 日，项目源码基线为 `2dd4df0`，本机锁定 Wrangler 4.155.0。命令以项目锁文件和当前 `--help` 为准。

示例域名和尖括号内容不是生产配置。维护者应在获授权的当前环境中解析实际目标，不从公开经验材料推断个人账号或域名归属。阅读本手册本身不授权部署、改 DNS 或轮换密钥。

## 配置定位表

| 位置 | 应核对的内容 |
| --- | --- |
| `wrangler.jsonc` | 原 API 的 name、account_id、main、兼容设置、绑定、migrations 和 vars |
| `wrangler.gateway.jsonc` | 网关的 name、account_id、入口文件及现有域名发布方式 |
| `server/gateway/worker.mjs` | 固定上游 UPSTREAM、ORIGINS、允许路径与方法 |
| `server/worker.mjs` | Origin 检查、签名验证、健康检查、对象选取 |
| `server/booking-sync.mjs` | 后台活动快照与 alarm 重试 |
| `scripts/build.mjs` | API_BASE_URL、CSP、版本和档案清单 |
| `.github/workflows/pages.yml` | main 触发的前端测试、构建及 Pages 发布 |

账号 ID 和实际服务映射只在执行环境核对，不附到公开报告。网关的固定上游目前写在源文件里；只改仓库的 API_BASE_URL 不会改变网关上游。

## 第一步 识别基线与正在进行的工作

```sh
pwd
git status --short
git branch --show-current
git log -5 --oneline
node --version
npm ci
npx wrangler --version
```

先读适用的 AGENTS.md。存在其他任务改动时使用隔离工作副本，只提交本次文件。核对锁文件，避免为了运行命令顺手升级 Wrangler 或兼容日期。

当前原服务使用 `ClubService`、`CLUB_SERVICE`、migration `v1` 与 `idFromName('sps-club-service-v1')`。这些是数据位置的技术标识，常规更新保持一致。不要把本项目 SQLite Durable Object 当成独立 D1 数据库，执行 D1 迁移或导入命令不适用。

## 第二步 核对授权和目标账号

复用有效的现有登录。需要检查时，在私有终端运行：

```sh
npx wrangler whoami
npx wrangler login --help
```

whoami 的原始输出可能含个人邮箱、账号名称与 ID，不粘贴到公开文档。只记录目标服务的访问是否可用。浏览器已登录、邀请已接受、CLI 已获授权、CLI 能部署特定 Worker 是不同检查点；拥有 Worker 权限也不等于拥有 DNS 权限。

确需重新登录时使用 `npx wrangler login`。默认 OAuth 流程需要浏览器能到达运行 Wrangler 的 localhost:8976。远程环境或本地回调不可达时，当前版本可用 `npx wrangler login --device`；设备码和回调 URL 不写入交接材料。不要把关闭所有代理或安全保护当成固定步骤，应先检查回调位置、端口与网络路径。[官方登录说明](https://developers.cloudflare.com/workers/wrangler/commands/general/)

两个配置文件要分别确认 account_id 与 Worker 名称。控制台或命令显示权限不足时，定位缺哪项授权；不要改向另一个可访问账号、创建同名 Worker 来“绕过”失败。

## 第三步 核对普通变量与密钥

| 名称 | 所在层 | 核对目的 |
| --- | --- | --- |
| API_BASE_URL | GitHub Actions 仓库变量或本地构建环境 | 前端请求入口，同时参与 CSP |
| ALLOWED_ORIGINS | 原 API vars | 精确允许网页 Origin |
| ORIGINS | 网关源码 | 与原 API 的允许来源协调 |
| REGISTRATION_OPEN | 原 API vars | 是否接受新账号注册 |
| EXPERIENCE_CLUB_ID | 原 API vars | 档案投稿所属社团，不能猜实际值 |
| BOOKING_CLUB_ID | 原 API vars | 活动发送所属社团，与接收端约定一致 |
| BOOKING_SYNC_URL | 原 API vars | 固定预约集成地址 |
| GATEWAY_SIGNING_KEY | 原 API 与网关 Secret | 校验网关传来的 IP 证明 |
| BOOKING_SYNC_KEY | 日程原 API Secret | 预约快照发送凭据 |
| SPS_SYNC_KEY | 预约接收端 Secret | 与发送端约定的同步凭据 |

Origin 只包含协议、主机和必要端口，不含 Pages 仓库路径或尾斜杠。例：页面在 `https://club.example.org/schedule/`，Origin 为 `https://club.example.org`。API_BASE_URL 使用裸 HTTPS origin，不填 `/api` 路径。

普通 vars 以部署配置为准。当前 Wrangler deploy 的默认行为可能覆盖控制台中的普通变量，应先将有意保留的配置纳入管理；不能假定手工在控制台改过就永久保留。`--keep-vars` 是需要明确选择的策略，不替代核对。Secret 与普通变量不同，不得把密钥写进 vars、前端 config 或 GitHub 公开 Variables。

可用以下命令检查 Secret 名称是否存在，不读取其值：

```sh
npx wrangler secret list --config wrangler.jsonc
npx wrangler secret list --config wrangler.gateway.jsonc
```

首次建立网关签名或另行授权轮换时，分别在交互提示中输入同一个受控随机值：

```sh
npx wrangler secret put GATEWAY_SIGNING_KEY --config wrangler.jsonc
npx wrangler secret put GATEWAY_SIGNING_KEY --config wrangler.gateway.jsonc
```

`secret put` 会创建版本并立即部署，不是仅修改一份本地配置。日常代码发布不需要重复设置已有 Secret；轮换应单独安排。当前项目只校验单个签名密钥，未实现双密钥过渡，不能承诺两端轮换期间无影响。[官方 Secret 行为](https://developers.cloudflare.com/workers/configuration/secrets/)

网关缺密钥会返回 503；原 API 对无效 IP 签名会退回传输来源，而不是统一拒绝整条业务请求。因此 health 返回成功不能证明两边密钥一致。签名只为限流来源提供证明，用户仍要通过 Bearer 会话和社团授权。

## 第四步 本地验证与部署预检

使用本地 .dev.vars 与隔离数据库，不复制生产登录信息。两终端分别启动 Worker 与构建预览：

```sh
npm run worker:dev
```

```sh
npm run build
npm run preview
```

按变更完成现有测试，再预检两个 Worker：

```sh
npm test
npm run test:worker
npm run test:gateway
npx wrangler deploy --config wrangler.jsonc --dry-run
npx wrangler deploy --config wrangler.gateway.jsonc --dry-run
git diff --check
```

dry-run 编译并检查上传内容，不实际部署，也不能证明远端账号权限、域名、Secret 或数据库状态正确。预检输出中若带实际账号或绑定值，不直接公开。

## 第五步 部署原 API 再检查网关

只有原 API 变更时执行：

```sh
npm run worker:deploy
npx wrangler deployments status --config wrangler.jsonc
npx wrangler deployments list --config wrangler.jsonc
```

记录部署前后版本，检查 health 和实际数据读取。部署输出成功后仍需确认数据位于原绑定，而不是只看 Worker 名称相同。

网关代码、路由或其相关配置变更时再执行：

```sh
npm run gateway:deploy
npx wrangler deployments status --config wrangler.gateway.jsonc
```

检查网关入口 health、CORS、未认证请求和附件读取。网关代码限制固定上游与允许路由，拒绝查询参数和重定向，不转发 Cookie 或客户端伪造的 IP 证明。旧后端尚无新接口时，不先发布依赖该接口的前端。

## 第六步 处理域名时保留已有绑定

本项目网关沿用预先配置的 Custom Domain，配置中关闭 workers.dev 与 preview URL；当前网关配置没有把域名 routes 纳入代码管理。普通发布不应新增 routes、打开备用公开入口或重绑 DNS。

如确需新增入口，由具备对应区域权限的一方核对目标主机的既有记录，在 Worker 的 Settings → Domains & Routes 中处理。先检查名称冲突与现有用途，再决定绑定；只有 Worker 邀请权限的一方可以准备交接要求，无需索要整区凭据。[官方域名绑定说明](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## 第七步 发布前端并读回结果

确认 GitHub 仓库 Pages 使用 Actions，API_BASE_URL 已指向本次可用入口。推送经过检查的 main 提交后，工作流依次安装、运行三套测试、构建、上传静态产物并部署。

本地生成指向生产入口的预览时，用本机已核验的地址替换示例：

```sh
API_BASE_URL=https://api.example.org npm run build
```

等待对应提交的工作流成功，再读 config.json、version.json 与实际界面。只更改经验文档也走这条链，不部署 Worker。

当前链路不是 Cloudflare Workers Builds 或 Cloudflare Pages 的 Git 集成；不得为了“自动化”同时启用另一条未知部署链。若未来要自动部署 Worker，另行设计有作用域的凭据、环境与部署顺序，并明确记录。

## 第八步 与预约服务及邮件的交接

预约接入先准备接收端，再设置精确社团绑定并部署发送端，必要时调用受保护补齐入口，最后核对手动预约和课程不变。发送端原数据库与预约数据库分别保留；详情见[验收与恢复](https://sps-club-schedule.github.io/sps-club-schedule/#/experience?folder=2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99Agent%E7%9C%8B%E7%9A%84%E7%BB%B4%E6%8A%A4&document=repo%3A2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99Agent%E7%9C%8B%E7%9A%84%E7%BB%B4%E6%8A%A4%2F09-Cloudflare%E9%AA%8C%E6%94%B6%E6%8E%92%E9%9A%9C%E4%B8%8E%E5%9B%9E%E6%BB%9A.md)。

邮件 DNS 使用服务商当前生成的记录；保留 API 主机绑定，回执只写目标记录是否配置及验证结果。发信 API 密钥属于原后端的受控 Secret，不进入网页，也不需要交给域名协作者。邮件通知尚未接通的状态应继续明确标注。

[整体讲解](https://sps-club-schedule.github.io/sps-club-schedule/#/experience?folder=2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99%E6%88%90%E5%91%98%E7%9C%8B%E7%9A%84%E6%B5%81%E7%A8%8B&document=repo%3A2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99%E6%88%90%E5%91%98%E7%9C%8B%E7%9A%84%E6%B5%81%E7%A8%8B%2F08-Cloudflare%E5%B7%A5%E4%BD%9C%E6%B5%81%E8%AE%B2%E8%A7%A3.md) · [验收排障与回滚](https://sps-club-schedule.github.io/sps-club-schedule/#/experience?folder=2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99Agent%E7%9C%8B%E7%9A%84%E7%BB%B4%E6%8A%A4&document=repo%3A2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99Agent%E7%9C%8B%E7%9A%84%E7%BB%B4%E6%8A%A4%2F09-Cloudflare%E9%AA%8C%E6%94%B6%E6%8E%92%E9%9A%9C%E4%B8%8E%E5%9B%9E%E6%BB%9A.md) · [返回阅读导航](https://sps-club-schedule.github.io/sps-club-schedule/#/experience?folder=2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5&document=repo%3A2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F00-%E9%98%85%E8%AF%BB%E5%AF%BC%E8%88%AA%E4%B8%8E%E7%89%88%E6%9C%AC%E8%AF%B4%E6%98%8E.md)
