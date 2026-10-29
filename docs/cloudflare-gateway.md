# Leafuke 域名网关

用户选择：使用 Leafuke 提供的 `sps-schedule.folderrewind.top` 作为 API 入口，账号、会话、社团和任务保留在原有 Cloudflare 数据库中。

请求路径：GitHub Pages → `sps-schedule.folderrewind.top`（Leafuke 的 `sps-club-schedule` Worker）→ `sps-club-api.sysu-physics-clubs.workers.dev` → 原 `ClubService` SQLite Durable Object。

## 配置

- `wrangler.gateway.jsonc`：Leafuke 账号中的网关 Worker。现有域名绑定由账号所有者维护，不修改其 DNS，也不启用 workers.dev / preview 地址。
- `wrangler.jsonc`：原账号的 API Worker。显式固定账号 ID，防止多账号登录后误部署。Durable Object 名称、绑定和 migration 均保持原样。
- 两个 Worker 都需要同一个 `GATEWAY_SIGNING_KEY` secret。不得写入 Git、公开变量或日志。
- GitHub 仓库变量 `API_BASE_URL` 应为 `https://sps-schedule.folderrewind.top`。Pages 构建同时更新公开配置和 CSP `connect-src`。
- 前端地址仍是 `https://sps-club-schedule.github.io/sps-club-schedule/`；该自定义域名只提供 API。

## 行为

只转发 `/api`、现有 `/auth/*` 接口和 `/health`，目标固定为原 API。精确保留 GitHub Pages CORS 白名单和 Bearer 会话。请求不传 Cookie，不跟随重定向，API 响应始终 `Cache-Control: no-store`。HTML 错误和网络异常转换成前端可处理的 JSON 错误。

Cloudflare 跨 zone 子请求会掩盖客户端 IP，因此网关使用 HMAC-SHA256 对客户端 IP 和时间戳签名；原 API 验证后再使用它做限流。伪造或超过60秒的签名不会覆盖真实传输来源。旧 API 仍可直接访问，便于兼容已打开的网页和回滚。

## 发布与回滚

```sh
npm test
npm run test:worker
npm run test:gateway
npm run worker:deploy
npm run gateway:deploy
```

首次部署前，在两个 Worker 中分别使用 `wrangler secret put GATEWAY_SIGNING_KEY` 设置相同的随机值（网关命令增加 `--config wrangler.gateway.jsonc`）。先验证新域名的 `/health`、CORS preflight、未认证 API 和无效邀请注册回滚，再更新 GitHub 仓库变量并发布 Pages。

回滚前端：把仓库变量恢复为 `https://sps-club-api.sysu-physics-clubs.workers.dev`，重跑 Pages 工作流。数据库没有迁移，不需要恢复或拷贝数据。

[Cloudflare 客户端 IP 与跨 zone 子请求](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip-in-worker-subrequests)。
