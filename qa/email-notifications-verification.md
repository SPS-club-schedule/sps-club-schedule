# 邮件通知验收记录

日期：2026-11-04。

## 自动与页面验证

- `npm test`：156项通过。
- `npm run test:worker`：原有55项 Worker 测试通过，新增13项 SQLite 邮件规则测试及1项真实 Worker 集成测试通过，总计69项。
- `npm run test:gateway`：4项通过。
- 合计229项。包含验证邮件、负责人事件、前24小时与到期边界、部门隔离、依赖完整完成、多重前置、去重、事务回滚、过期、重试、模糊响应、限额、持久化重启、旧账号兼容、未授权内部接口和成员数据隐私。
- `wrangler deploy --dry-run`：构建成功，保持原 `ClubService` 绑定。
- 浏览器本地验收：新用户表单出现必填常用邮箱；模拟旧账号登录后进入账号设置并提示补填；填写邮箱、确认密码、输入模拟验证码后显示“已验证”。
- 本地截图：`qa/email-registration-20261104.png`、`qa/email-verified-20261104.png`（忽略提交）。
- 所有自动测试与本地浏览器测试使用模拟 Resend。未向现有成员发送测试通知，未将模拟投递当成真实邮箱收件确认。

## 发布

- 功能提交：`35489f901094efa5e9787506e828aca0760a8185`。
- 业务 Worker：`sps-club-api`，2026-11-04 15:11 UTC 发布；当前100%流量版本 `742304d9-fe7e-4724-8d71-0a30fd7fc161`。
- Wrangler 确认 Cron `* * * * *` 已部署。Miniflare 已执行真实 scheduled 入口；本次短时生产 tail 未捕获定时事件，未据此宣称生产定时邮件已投递。
- 发布前实时读取 Secret 名称，确认 `RESEND_API_KEY` 存在；未读取或输出其值。
- [GitHub Pages 工作流 41855408617](https://github.com/SPS-club-schedule/sps-club-schedule/actions/runs/41855408617)：build/deploy 全部 success，CI 在 Node 22 完成全部229项测试。
- 公网版本：`b13080368b504becd57cec42b6d4028d`，脚本 `app-O73OQIW2.js`。
- 公网 `/health`：HTTP 200，`{ "ok": true, "service": "sps-club-api" }`。
- 公网注册不填邮箱：HTTP 400，“请填写常用邮箱”；此探测未创建账号。
- 公网 `/internal/mail-tick`：HTTP 404；发送入口不能由外部用户调用。
- Chrome 重新打开正式网站，注册页已显示常用邮箱输入框与注册后验证说明；截图 `qa/email-live-registration-20261104.png`。
- 实际收件验收待成员自行绑定常用邮箱，输入收到的验证码；本轮未创建生产测试账号或向真实成员发送测试邮件。
