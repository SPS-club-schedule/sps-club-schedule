# SPS 邮件通知：给维护者和 Leafuke 的 Codex

更新日期：2026-11-05。此文件描述本次实现；发布结果见 `qa/email-notifications-verification.md`。

## 用户要求和最终行为

| 场景 | 收件人 | 触发与内容 |
| --- | --- | --- |
| 新用户注册 | 填写的常用邮箱 | 必填邮箱；发送6位验证码，15分钟有效 |
| 老用户登录且没有邮箱，或邮箱未验证 | 网站上的本人 | 登录后进入账号设置；工作台显示补填/验证提醒，不阻断原有任务操作 |
| 新建任务、任务组，或子任务新增负责人 | 由他人新增的注册负责人 | 同一主任务下，首项分配起一分钟内的分工合成一封邮件，每项列出名称、截止时间、详情链接 |
| 截止前24小时 | 尚未完成自己部分的负责人 | 同一主任务、同一截止时刻的个人待办合成一封提前提醒，每项可点击查看 |
| 到达截止时间仍未完成 | 尚未完成的负责人 | 同一主任务、同一截止时刻只发一封到期邮件，逐项列出未完成的工作 |
| 同一任务逾期 | 上述未完成人所属部门的所有 `department_admin` | 每位管理员按主任务和截止时刻收到一封汇总，逐项列出本部门未完成人 |
| 某个前置任务整体完成 | 下游任务中尚未完成的注册负责人 | 给出前置任务及其负责人姓名，请对接；所有前置完成才提示可以开始，否则列出仍需等待的前置 |

同一账号既是任务负责人又是相关部门管理员时，合并为一封到期邮件。多人逐人完成任务按每个人的完成记录计算；协作任务由任一指定负责人完成后停止全部截止提醒。免注册负责人没有账号邮箱，因此不会收到邮件。没有部门或没有对应部门管理员时，仅通知本人。

邮箱需验证后才接收任务邮件；验证码可一分钟后重发，另有账号、IP和目标邮箱限流。修改邮箱须确认当前密码，并重新验证。邮箱保存在私有账号表中，只返回给本人；成员列表、管理员成员列表、公开档案和预约同步不包含邮箱。

## 已完成的服务配置

- API 仍经 `https://sps-schedule.folderrewind.top` 网关访问原业务 Worker `sps-club-api`，保留原 Durable Object `sps-club-service-v1`。不迁移数据库，不更换账号、密码或已有任务。
- 发信域名：`sps-schedule.folderrewind.top`；Resend Tokyo 区域。DNS 三条记录及域名已于本轮配置中验证通过，保持原 DNS 记录。
- 发件人：`SPS 社团日程 <notifications@sps-schedule.folderrewind.top>`。此地址用于发送，未配置收信。
- 用户已确认创建并保存只允许该域名发信的密钥。`RESEND_API_KEY` 已保存为业务 Worker Secret；不要读取、导出或写入仓库、聊天、前端、`.env.example`。
- 网关 Worker 不需要此密钥，也无需新增公开定时任务接口。

## 代码和配置

- `server/mail.mjs`：邮箱验证、通知规则、私有邮箱表、持久化发件队列、Resend 请求、去重与重试。
- `server/worker.mjs`：账号注册必填邮箱；事务中写入任务和邮件事件；Cron 每分钟唤醒原 Durable Object。
- `server/account.mjs`：本人邮箱绑定、重发、验证，复用会话、密码确认和账号版本冲突保护。
- `client/account-views.js`、`client/views.js`、`client/app.js`：注册表单、老账号提醒、账号邮箱设置和验证码确认。
- `shared/email.js`：服务端邮箱格式校验。
- `wrangler.jsonc` 的普通变量：

```text
EMAIL_NOTIFICATIONS_ENABLED=true
EMAIL_DAILY_LIMIT=100
EMAIL_FROM=SPS 社团日程 <notifications@sps-schedule.folderrewind.top>
EMAIL_SITE_URL=https://sps-club-schedule.github.io/sps-club-schedule/
```

定时表达式为 `* * * * *`。DO 原有 alarm 继续处理预约同步；邮件使用 Cron，互不占用。业务写入完成后也会尝试立即投递，Cron 用于无人打开网站时的提醒和恢复重试。

## 投递约束和恢复

1. 新建 SQL 表 `account_emails`、`email_outbox`、`email_meta`、`email_usage`，不改已有账号和任务。事件在任务事务内写入；Resend 网络请求在事务外执行。
2. 同一业务事件有稳定队列 ID，并作为 Resend `Idempotency-Key`。网络失败/限流重试使用首次发送的固定正文，避免同键内容变化。Resend 幂等键有效24小时，因此不对首次尝试已超过23小时的模糊结果继续发送，以免重复。
3. 发送前检查任务是否归档/完成、负责人/部门权限是否变化、截止时间是否修改、前置依赖是否撤销。失效事件取消。修改截止时间后，新时间可生成新提醒。截止汇总已尝试发送且重试时正文发生变化的，标为结果待核实，以免再次投递过时的任务或部门名单。
4. 每分钟检查，正常情况下到期提醒在下一次检查投递；网络、排队、供应商限制和收件方过滤会造成延迟，不能保证准点到达收件箱。
5. 本地发送预算默认每天100次首次发送尝试（UTC 日期，验证码也计入）。超额保留队列至下一天；还受 Resend 账号实际日/月额度约束。需要更多容量时，由维护者先确认当前套餐，再调整 `EMAIL_DAILY_LIMIT`，不要自动开通付费服务。
6. 已上线前就过期的任务不批量追发；前24小时的提醒点已在启用之前的，也不补发那一封。上线后的到期事件最多追赶7天；前24小时提醒到截止即失效，任务分配通知有效7天，依赖完成通知有效2天，验证码15分钟。
7. 负责人撤销完成后重新完成，属于新的一次依赖完成事件，可再次提醒；同一截止时间的到期邮件仍只发一次。
8. 发送成功表示 Resend 接受请求，不等同于收件人已阅读或邮件已进入收件箱。可在 Resend Emails 中查看 delivered/bounced 等实际结果。本轮自动测试使用模拟投递，不冒充真人收件确认。
9. 非排队历史事件30天后清理；发送完成和过期后清除队列中正文/验证码。只记录提供方邮件 ID 和错误类别，不记录密钥。

## 给接手 Codex 的操作要求

先读当前仓库状态与此文件，以最新线上版本为准。保留工作区已有改动，保留原 Worker 名称和 Durable Object 绑定。不要把邮箱加进 `safeMember`、管理员成员列表或预约同步请求。不要重新创建 Resend 密钥或覆盖已有 Secret，也不要修改 Leafuke 网关 DNS。

验证命令：

```sh
npm test
npm run test:worker
npm run test:gateway
API_BASE_URL=https://sps-schedule.folderrewind.top npm run build
```

`test:worker` 包含邮件规则的真实 SQLite 测试，以及 Miniflare 中的注册、验证码、旧账号兼容、定时触发、持久化重启、隐私和限流集成测试。测试邮箱均为 `example.test`，出站 Resend 请求被模拟，不能把模拟成功写成真实投递成功。

发布业务 Worker 使用 `npm run worker:deploy`。前端经 main 分支 GitHub Pages 工作流发布。发布后核对 Worker Cron、Secret 名称、版本、Pages 工作流以及公网 `/health`；真实收件验收使用自愿测试者自己的邮箱，在网站完成验证，再按上述场景验收，避免向现有成员批量发送测试邮件。

需要暂停发信时将 `EMAIL_NOTIFICATIONS_ENABLED=false` 后部署业务 Worker；注册/登录/任务操作仍可用，队列保留但不发送。恢复前检查积压和已过期事件。删除 Cron 会同时失去无人访问时的提醒及恢复机制，不建议作为停发开关。

参考官方说明：[Resend 发送 API](https://resend.com/docs/api-reference/emails/send-email)、[24小时幂等键](https://resend.com/docs/dashboard/emails/idempotency-keys)、[Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。
