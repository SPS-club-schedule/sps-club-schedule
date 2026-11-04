# Cloudflare 工作流讲解

这篇面向网站负责人和后来接手的同学，说明网站的云端部分怎样协作，一次修改怎样上线，以及出了问题先检查哪里。具体命令见[配置与发布操作手册](https://sps-club-schedule.github.io/sps-club-schedule/#/experience?folder=2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99Agent%E7%9C%8B%E7%9A%84%E7%BB%B4%E6%8A%A4&document=repo%3A2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99Agent%E7%9C%8B%E7%9A%84%E7%BB%B4%E6%8A%A4%2F08-Cloudflare%E9%85%8D%E7%BD%AE%E4%B8%8E%E5%8F%91%E5%B8%83%E6%93%8D%E4%BD%9C%E6%89%8B%E5%86%8C.md)，异常处理见[验收排障与回滚](https://sps-club-schedule.github.io/sps-club-schedule/#/experience?folder=2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99Agent%E7%9C%8B%E7%9A%84%E7%BB%B4%E6%8A%A4&document=repo%3A2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F%E7%BB%99Agent%E7%9C%8B%E7%9A%84%E7%BB%B4%E6%8A%A4%2F09-Cloudflare%E9%AA%8C%E6%94%B6%E6%8E%92%E9%9A%9C%E4%B8%8E%E5%9B%9E%E6%BB%9A.md)。

记录日期：2026 年 11 月 4 日。这里的“工作流”指项目的开发和发布流程；项目当前没有使用名为 Cloudflare Workflows 的产品。全文用“项目维护者”和“域名协作者”描述分工，不记录个人账号、域名归属或控制台截图。

## 网站由哪几部分组成

| 部分 | 实际职责 | 本项目如何发布 |
| --- | --- | --- |
| GitHub Pages | 提供 HTML、JS、CSS 与仓库经验文件 | 推送 main 后由 GitHub Actions 构建发布 |
| 网关 Worker | 接收自定义 API 域名请求，检查允许来源和路由，转给固定上游 | 单独使用网关配置部署 |
| 原 API Worker | 认证、授权、任务和档案接口 | 使用原 API 配置部署 |
| SQLite Durable Object | 保存账号、社团、任务、完成记录、网页档案及同步状态 | 业务代码访问既有绑定与对象 |
| 预约服务 | 接收持续活动快照，保留自己的手动预约与课程 | 属于另一个服务的发布链 |

这里没有把前端迁到 Cloudflare Pages。Pages 在项目名称中指 GitHub Pages；Cloudflare 承担 API 与持久化工作。

一个“完成任务”操作依次经过网页、网关、原 API、数据库。修改成功回到网页后再显示确认；另一位成员随后通过增量同步看到变化。

## 为什么增加网关后没有搬数据库

项目需要一个新的 API 入口，同时保留已有账号和任务。于是把域名入口放在网关，数据库和原服务保持原位置。这样成员继续使用原账号，维护者也不用导出再导入全部社团数据。

“域名能访问”“后端代码已更新”“数据库仍是原来的那份”需要分别确认。改了 Worker 名称、Durable Object 绑定或对象名，可能让程序访问到另一个存储位置；出现空列表不能马上得出数据丢失的结论。

## 两类维护者怎样配合

项目维护者负责代码、原 API、数据兼容和前端发布。域名协作者负责其有权限管理的域名绑定或 DNS；具体账号和权限明细留在受控交接中。

可以拥有某个 Worker 的部署权限，却没有整个 DNS 区域的管理权限。遇到这种情况，继续复用已有的域名绑定，由域名管理方处理确需更改的记录。双方不需要交换密码、完整 API token 或整个账号的访问权限。

## 一次正常功能更新

1. 明确用户希望什么行为改变，以及哪些旧数据必须保留。
2. 在本地 Worker 和隔离 SQLite 中实现、测试，检查电脑与手机操作。
3. 判断变更涉及哪些部分。纯文档只走 Pages；新增 API 通常要先更新原 API；增加网关允许的路由时再更新网关。
4. 发布后端，检查原 API；再发布网关并检查自定义入口。
5. 后端可用后推送前端，等待 Actions 的构建和部署结束。
6. 从正式页面验证新功能，同时确认已有账号、任务、预约和档案仍能使用。

源代码推上 GitHub，不等于 Cloudflare Worker 自动更新。本项目当前没有把 Worker 部署放进 Pages 工作流。维护交接应分别说明“后端部署完成”和“前端部署完成”。

## 首次接入一个域名

先确认目标主机、既有记录和 Worker 绑定，再由有权限的一方配置。Cloudflare Custom Domain 把具体主机名连接到 Worker；已有 CNAME 或其他用途可能造成冲突，不能为了绑定成功直接删除旧记录。创建入口后，还要核对证书、允许的网页来源以及实际 API 响应。[官方 Custom Domains 说明](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

本项目已有入口时，普通代码发布沿用既有绑定，不必每次重新做 DNS。邮件验证又是另一项操作：新增发信记录不能误改 API 主机记录，DNS 就绪也不代表网站已经有邮件通知功能。

## 区分公开配置与密钥

网页需要知道去哪个 API 请求，API 地址会进入前端构建结果；它本身不能作为密码。网关与原 API 之间的签名密钥、预约同步密钥则只保存在服务端 Secret。

公开经验文档只说明配置名称及作用，用 `api.example.org` 等示例域名表示地址。账号 ID、实际内部映射、私人邮箱、认证回调、恢复码、完整日志和密钥值不放入档案。即使给 agent 阅读，也遵守同样范围。

## 出问题时先分层

| 现象 | 首先检查 |
| --- | --- |
| 网页打不开 | Pages 部署、静态资源与网络 |
| 网页能打开但提示连接失败 | API 地址、CORS、网关、原 API |
| 原 API 可用而域名入口失败 | 域名绑定、网关部署与固定上游 |
| 登录正常但列表突然为空 | 所选社团及原存储绑定，不急着重建 |
| 活动已保存但预约页没有 | 是否有完整时段、同步队列与接收端确认 |
| 最新文档没有出现 | Pages 索引及实际正文是否已更新 |
| 更新后某个旧功能异常 | 比较前后端版本与数据兼容，确定回退哪一层 |

回退代码通常继续使用当前数据库。恢复数据库会影响恢复点之后的业务记录，属于另一种操作。不能因为前端样式出错就恢复整个数据库。

## 完成一次交接应留下什么

留下日期与时区、改动范围、代码版本、各层是否部署、验证结果、回退方法和未完成事项。用技术角色描述分工，用摘要描述异常。控制台完整截图、个人账号清单和访问凭据留在受控环境中。

[返回阅读导航](https://sps-club-schedule.github.io/sps-club-schedule/#/experience?folder=2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5&document=repo%3A2026-2027%E5%B1%8A%2F%E7%BD%91%E7%AB%99%E7%BB%B4%E6%8A%A4%2FSPS%E7%A4%BE%E5%9B%A2%E6%97%A5%E7%A8%8B%E5%BB%BA%E8%AE%BE%E4%B8%8E%E4%BA%A4%E6%8E%A5%2F00-%E9%98%85%E8%AF%BB%E5%AF%BC%E8%88%AA%E4%B8%8E%E7%89%88%E6%9C%AC%E8%AF%B4%E6%98%8E.md)
