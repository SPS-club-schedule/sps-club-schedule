# 给 Leafuke 的 Codex：配置 SPS 日程网站的 Resend 发信 DNS

日期：2026-11-04（北京时间）

> Leafuke：把这个文件交给你的 Codex，并发送：
>
> **请按附件执行：在我管理的 Cloudflare `folderrewind.top` 区域中检查并配置指定的 3 条 Resend DNS 记录，完成后验证并生成回执。遇到现有记录冲突先向我说明。**

## 任务目标

你正在协助 Leafuke 管理其 Cloudflare DNS。请为 SPS 社团日程网站的发信域名 `sps-schedule.folderrewind.top` 配置下列 3 条记录，让网站维护方能够在自己的 Resend 账号中验证域名并发送任务通知。

Resend 域名已由网站维护方创建，发信区域为 Tokyo / `ap-northeast-1`。下列记录已从该域名的 Resend 控制台逐项提取；请使用这些实际值，不用教程示例替换。

预期发件人为 `SPS 社团日程 <notifications@sps-schedule.folderrewind.top>`。本次工作只涉及 DNS；Resend 验证、API 密钥和网站通知代码由网站维护方继续完成。

## 目标记录：完整且可直接复制

Cloudflare 区域：`folderrewind.top`。

| Type | Cloudflare UI 的 Name | 完整 DNS 名称 | Content / Target | TTL | 代理 |
| --- | --- | --- | --- | --- | --- |
| TXT | `resend._domainkey.sps-schedule` | `resend._domainkey.sps-schedule.folderrewind.top` | 下方完整 DKIM 公钥 | Auto | 不适用 |
| CNAME | `rsend.sps-schedule` | `rsend.sps-schedule.folderrewind.top` | `rsend-apne1.forge.rmta.net` | Auto | DNS only / 灰云 |
| CNAME | `send.sps-schedule` | `send.sps-schedule.folderrewind.top` | `send.forge.rmta.net` | Auto | DNS only / 灰云 |

DKIM TXT 的完整 Content：

```text
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC/nHquffg1rzq2FvF1nODwk0pGAXKyhSLcCuIprqnQUb3n1Fmcm6xBKZn9cGIMM49/ukv+rM4nJOb9RQhPUeNgvfQ1WXGrUMquLFLU3nvHA+bWsYGosGnBominfQDxlyphSOcVxio9p6nYebG+vcB6M6BIZJAQyvcbPQkvZ7wgYQIDAQAB
```

TXT 内容保持为完整单行；不要加入代码块标记、外层引号或手动换行。DKIM 内容区分大小写。CNAME Target 不加协议和路径。

## 操作步骤

### 1. 使用现有登录与权限

优先使用当前环境已经连接并具有 DNS 管理能力的 Cloudflare 工具或 API；若没有可用接口，使用 Leafuke 已登录的 Cloudflare 浏览器页面。

先只读确认当前账号能管理 `folderrewind.top`，再在该区域操作。若当前会话没有权限，请让 Leafuke 在自己的浏览器中登录有权限的账号。凭据始终留在他的环境中，不要求他把 Cloudflare 密码、API Token 或 Cookie 发给网站维护方，也不要把凭据写入日志或回执。

### 2. 写入前检查

先检查全部目标，再决定写入：

1. 查询上表 3 个完整名称的**所有类型**现有记录，记录目标条目的名称、类型、内容、TTL、代理及记录级 Flatten 设置（如有）。
2. 检查区域是否启用 `Flatten all CNAME records`，以及是否存在影响这些名称的子域 NS 委派。
3. 只读记录现有 API 主机 `sps-schedule.folderrewind.top` 的 DNS/Worker 自定义域名绑定状态（以现有权限能查看的内容为限），并检查公开健康接口：

   ```sh
   curl --fail --silent --show-error --max-time 20 https://sps-schedule.folderrewind.top/health
   ```

4. 按以下规则处理：
   - 名称、类型和内容均一致：复用现有记录，不重复创建。
   - 内容一致，但目标 CNAME 开了代理、记录级 Flatten，或目标记录 TTL 不是 Auto：可仅调整这 3 条目标记录到要求的状态。
   - 同名存在不同内容、其他用途的记录，或 CNAME 名称下已有其他类型记录：列出具体冲突，先请 Leafuke 决定，暂不写入。
   - 有影响目标名称的 NS 委派或全区域 CNAME flattening：说明影响，先请 Leafuke决定处理方式；不直接修改区域级设置或删除 NS。

比较 CNAME 时可忽略域名大小写和末尾根点；比较 TXT 时可拼接 DNS 返回的引号分段，但必须保留内容本身的大小写。

健康接口若在写入前已失败，记录原始状态，避免把既有问题当作本次 DNS 操作造成的问题。

### 3. 创建或调整目标记录

确认无冲突后，添加缺失记录，并仅对匹配内容的已有目标记录调整上述设置：

- UI 操作时，在 `folderrewind.top` 区域使用表中的相对 Name，避免重复附加根域名。
- 使用 API/工具时，按其实际 schema 填入完整名称和对应内容；如需 API 参数说明，查阅当前官方文档。
- 两条 CNAME 必须为 **DNS only**，并关闭记录级 CNAME flattening（若该设置可用）。
- TTL 设为 **Auto**。
- 回读保存后的记录，逐项核对实际值。记录本次新增或调整的记录 ID（若工具提供），以便追踪。

本轮操作范围限定为上述 3 条记录。保留现有 `sps-schedule` API 主机记录、代理状态、Worker 自定义域名绑定及 Worker 代码；保留根域名和其他子域现有的 MX/SPF/DMARC。Resend 本次使用两条 CNAME 承载发信配置，无需补充旧教程中的 MX/SPF TXT，也不启用收件服务。

如果中途失败，报告已经成功执行的步骤和剩余项；不要为了重试而删除同名记录或重建整个 DNS 区域。

### 4. 验证

同时确认控制台/API 已保存，以及公开 DNS 是否可见：

```sh
dig +short NS folderrewind.top
dig +short TXT resend._domainkey.sps-schedule.folderrewind.top
dig +short CNAME rsend.sps-schedule.folderrewind.top
dig +short CNAME send.sps-schedule.folderrewind.top
curl --fail --silent --show-error --max-time 20 https://sps-schedule.folderrewind.top/health
```

如本地递归解析器仍有缓存，可从首条命令返回的**实际权威服务器**查询目标记录，或使用环境中可用的其他 DNS 查询工具。不要把 DNS 网络超时当成“记录不存在”。

验证标准：

- DKIM TXT 拼接后的内容与上述公钥一致。
- `rsend.sps-schedule.folderrewind.top` 返回 `rsend-apne1.forge.rmta.net.`。
- `send.sps-schedule.folderrewind.top` 返回 `send.forge.rmta.net.`。
- API 健康检查与操作前相比未因本次操作发生异常。

若记录已经保存但公开查询尚未更新，明确标为“已配置，等待 DNS 生效”。不要只凭写入成功就声称验证全部通过，也不必为等待缓存消退而反复重写记录。

你不需要登录或创建 Resend 账号、索取其 API 密钥、发送测试邮件。即使 DNS 查询全部正确，也只能报告 DNS 已就绪；最终的 **Resend Verified** 状态须由网站维护方在其账号中确认。

## 完成后输出回执

请生成一份 `SPS-Resend-DNS配置回执.md`，供 Leafuke 转发给网站维护方。包含以下内容，不附带任何凭据：

```markdown
# SPS Resend DNS 配置回执

- 操作时间：YYYY-MM-DD HH:mm（注明时区）
- Cloudflare 区域：folderrewind.top
- 总体结果：已完成并公开解析正常 / 已保存等待解析生效 / 因冲突或权限受阻

| 名称 | 类型 | 本次操作（新增/复用/调整/未处理） | 保存后值核对 | 公开 DNS 查询 |
| --- | --- | --- | --- | --- |
| resend._domainkey.sps-schedule.folderrewind.top | TXT | | | |
| rsend.sps-schedule.folderrewind.top | CNAME | | | |
| send.sps-schedule.folderrewind.top | CNAME | | | |

- 两条 CNAME 的代理与 Flatten 状态：
- API /health 操作前及操作后结果：
- 异常、冲突或尚待完成项：
- 交接：请网站维护方在 Resend 验证域名，并继续配置专用发信密钥与通知功能。
```

必要时附目标记录的查询结果或不含敏感信息的截图。回执只涉及本任务，不导出整个 DNS 区域或其他业务配置。

## 官方参考

- [Resend 域名管理：新版 CNAME 发信记录](https://resend.com/docs/dashboard/domains/manage-domains)
- [Resend 的 Cloudflare DNS 配置指南](https://resend.com/docs/guides/dns/cloudflare)
- [Cloudflare：CNAME 域名验证与代理、Flatten 设置](https://developers.cloudflare.com/dns/manage-dns-records/troubleshooting/cname-domain-verification/)
