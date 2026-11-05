# SPS 日程网站接入 Resend：给 Leafuke 的 DNS 配置说明

更新日期：2026-11-04（北京时间）

Leafuke，想给 SPS 社团日程网站增加任务分配、时间变更及截止提醒邮件。我们已在自己的 Resend 账号中添加下面的发信域名，需要你在 `folderrewind.top` 的 Cloudflare DNS 中添加 **3 条记录**。Resend 账号、API 密钥和后端通知功能由我们负责。

## 1. 本次使用的域名和用途

| 项目 | 配置 |
| --- | --- |
| 发信域名 | `sps-schedule.folderrewind.top` |
| 拟用发件人 | `SPS 社团日程 <notifications@sps-schedule.folderrewind.top>` |
| 发信服务 | Resend |
| Resend 发信区域 | Tokyo / `ap-northeast-1` |
| 功能 | 发送网站事务通知；暂不开启收件、打开追踪或点击追踪 |
| 当前进度 | 2026-11-04 已完成 DNS 配置，Resend 域名与三条记录均已 Verified；以下保留原配置清单供查阅 |

这次是在现有 API 域名下增加邮件认证所需的子域记录。网站 API 仍使用 `https://sps-schedule.folderrewind.top`，现有 Worker 自定义域名绑定及 API 解析继续保留。

## 2. 需要添加的 3 条 DNS 记录

下面内容来自 **本次 Resend 域名页面实际生成的记录**，不是教程示例。进入 Cloudflare → `folderrewind.top` → DNS → Records，添加以下记录。

表中 Name 为相对于 `folderrewind.top` 的名称；不要再把完整根域名重复拼接一次。

| 序号 | Type | Name（Cloudflare 名称） | Content / Target | Proxy status | TTL |
| --- | --- | --- | --- | --- | --- |
| 1 | TXT | `resend._domainkey.sps-schedule` | 完整复制下方 DKIM 内容 | TXT 无代理开关 | Auto |
| 2 | CNAME | `rsend.sps-schedule` | `rsend-apne1.forge.rmta.net` | **DNS only（灰云）** | Auto |
| 3 | CNAME | `send.sps-schedule` | `send.forge.rmta.net` | **DNS only（灰云）** | Auto |

第 1 条 TXT 的完整 Content（复制代码块内这一整行，不加外层引号）：

```text
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC/nHquffg1rzq2FvF1nODwk0pGAXKyhSLcCuIprqnQUb3n1Fmcm6xBKZn9cGIMM49/ukv+rM4nJOb9RQhPUeNgvfQ1WXGrUMquLFLU3nvHA+bWsYGosGnBominfQDxlyphSOcVxio9p6nYebG+vcB6M6BIZJAQyvcbPQkvZ7wgYQIDAQAB
```

保存后，3 条记录的完整名称应分别是：

```text
resend._domainkey.sps-schedule.folderrewind.top
rsend.sps-schedule.folderrewind.top
send.sps-schedule.folderrewind.top
```

注意事项：

- 两条 CNAME 均使用 **DNS only**，不启用 Cloudflare 代理，也不为它们单独启用 CNAME flattening，以便 Resend 能查询到原始 CNAME。若整个 DNS 区域已启用“Flatten all CNAME records”，请告诉我们，先评估对其他记录的影响再调整。
- CNAME 目标只填表中主机名，不加 `https://`，也不加路径。
- 本次是 Resend 新版发信记录：**两条 CNAME 加一条 DKIM TXT**。不需要另抄旧教程中的 `send` MX、SPF TXT 或 Amazon SES 示例值。
- 若相同名称已经有其他用途的记录，先告诉我们冲突的名称及类型，不直接覆盖；尤其是 CNAME 不能与同名 TXT/MX 等记录并存。
- 保留现有 API 主机 `sps-schedule` 的记录、代理状态和 Worker 绑定；本次两个新 CNAME 的 Name 分别是 `rsend.sps-schedule` 与 `send.sps-schedule`，不要误填为 `sps-schedule`。
- 本轮只配发信，不添加接收邮件的 MX，也不修改根域名 `folderrewind.top` 的 MX/SPF/DMARC。DMARC 后续结合发信测试和现有域名策略单独配置。

## 3. 添加后如何交接

添加完成后回复我们“3 条 DNS 已添加”，如有冲突说明是哪一条即可。我们随后在 Resend 点击验证，检查 DKIM 和两条发信 CNAME 的状态，再完成后端接入与邮件测试。

可选：你也可以在终端查询公开 DNS，确认结果与表中一致：

```sh
dig +short TXT resend._domainkey.sps-schedule.folderrewind.top
dig +short CNAME rsend.sps-schedule.folderrewind.top
dig +short CNAME send.sps-schedule.folderrewind.top
```

TXT 查询可能把内容拆成几段带引号的字符串，拼接后的内容一致即可。最终仍以 Resend 验证状态为准；DNS 缓存可能导致延迟，官方说明验证最长可能需要 72 小时，通常更快。

这些记录在验证通过后需要保留，Resend 会持续检查。以后若要撤销这个域名的发信授权，请提前通知我们停发，再移除本次记录。

## 4. 分工与权限需求

- **Leafuke**：在你管理的 DNS 区域中添加上面 3 条记录，并反馈完成或冲突情况。
- **网站维护方**：管理 Resend 账号、验证域名、保存仅用于该域名发信的 API 密钥、开发并部署邮箱绑定与通知逻辑、处理发送限额与失败重试。
- 你不需要提供 Cloudflare 密码、API Token 或整个域名的 DNS 管理权限，也不需要登录我们的 Resend 账号。
- 本文件只有公开 DNS 记录；DKIM 这段是公钥，不含 Resend API 密钥或 Cloudflare 凭据。
- 发信地址验证后可以通过 Resend 发送邮件，但不会自动成为可登录或可收信的邮箱；回复邮箱如有需要由我们另行设置。

## 5. 官方参考

- [Resend 域名管理与新版 CNAME 发信记录](https://resend.com/docs/dashboard/domains/manage-domains)
- [Resend 的 Cloudflare DNS 配置指南](https://resend.com/docs/guides/dns/cloudflare)
- [Resend 发信区域说明](https://resend.com/docs/dashboard/domains/regions)
- [Cloudflare：CNAME 域名验证与代理、Flatten 设置](https://developers.cloudflare.com/dns/manage-dns-records/troubleshooting/cname-domain-verification/)

如果教程示例与本文件不同，以当前 Resend 控制台为 `sps-schedule.folderrewind.top` 生成的记录为准。更换域名或重新创建 Resend 域名后，须重新导出记录，不继续沿用旧 DKIM 内容。
