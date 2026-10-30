# SPS 经验档案

公开入口：`#/experience`。访客可以按文件夹浏览、搜索、在线阅读和下载；只有 `EXPERIENCE_CLUB_ID` 指定的 SPS 社团有效成员可以创建文件夹、上传资料和新建在线文档。前端的登录页和所有成员导航都提供入口。

电脑沿用左侧导航、窄目录栏、宽资料区，独立滚动；手机使用完整档案页面和底部导航。支持任意届次、部门、主题的嵌套目录，已预建 `2026-2027届` 的宣传部、联络部、学术部空目录。没有填入虚构的历届经验。

## 两种投稿来源

1. **网页上传**：无需 GitHub 账号。一次可选多个文件，逐个上传并显示进度；失败保留剩余文件，可重试。上传成功后打开目标目录。上传者可以修改名称、路径与说明，也可收起和恢复资料。网站维护管理、总管理员、创始人可整理全部网页资料；其他成员只能整理自己上传的资料。
2. **GitHub / agent**：把文件放入仓库 `experience/`，提交到 `main` 后由现有 Pages 工作流自动校验、生成清单并发布。辅助命令：`npm run experience:add -- /absolute/file.pdf "2026-2027届/学术部"`。辅助命令不覆盖同名文件，也不自动提交或推送。Agent 操作说明见 [experience/AGENTS.md](../experience/AGENTS.md)。

两种来源按相同目录路径合并展示，来源清晰标注。**网页上传不会自动提交到 GitHub，GitHub 文件通过仓库维护**；两者同名不会互相覆盖。Agent 可以通过公开 API 读取网页投稿资料，配合 SHA-256 校验进行整理或备份。GitHub 的提交权限沿用原仓库，不向浏览器或 Worker 部署 GitHub 凭据。

## 在线阅读与编辑

Markdown（`.md`）、LaTeX 公式（`.tex`）和纯文本（`.txt`）可直接在线阅读；UTF-8 文件最多 256 KiB。其他格式及更大的文件仍可下载。文档有可分享的 `document` 链接，阅读前核对清单 SHA-256，避免在旧版本元数据上编辑新正文。

成员点击“新建文档”选择格式并填写路径，编辑器即时显示预览；可保存并公开、下载源码。上传者及档案维护者可通过“编辑正文”更新网页文件，沿用原 ID、路径和作者，更新版本、大小及 SHA-256。保存失败保留草稿；版本冲突拒绝覆盖。未保存时退出编辑、站内导航或关闭页面会提示。

仓库文件和其他成员文件可阅读；有投稿权限的成员可“编辑并另存副本”，保存为独立网页文件。不会改写 GitHub 原文或绕过其他成员文件的编辑权限。

Markdown 支持标题、列表、表格、代码及 `$…$` / `$$…$$` / `\(…\)` / `\[…\]` 公式。`.tex` 直接预览公式、矩阵、aligned 等 KaTeX 支持的环境；完整 LaTeX 文档显示源码和下载提示，不执行 TeX 或生成 PDF。公式错误就地显示，代码块内的公式符号保持原样。

解析器关闭原始 HTML，KaTeX 使用 `trust:false` 并限制宏展开。渲染模块按需加载，样式与字体随网站发布，不依赖外部 CDN。所有正文仍按附件下载；页面只插入受限解析器的输出，保留原 CSP。

## 文件与存储

单文件最多 10 MiB，路径最多 8 层、400 字符，每段最多 120 字符。允许 PDF、Word、PPT、Excel、CSV、Markdown、LaTeX 源码、纯文本、RTF、OpenDocument、常见位图、ZIP 和 7z。禁止网页、SVG、可执行文件、符号链接、隐藏路径和目录穿越。上传表单明确提示资料将公开。

网页档案位于原 Durable Object 的独立 `experience_entries`、`experience_chunks` 表。文件按 256 KiB BLOB 分块，低于 [Cloudflare SQLite 单行 2 MB 限制](https://developers.cloudflare.com/durable-objects/platform/limits/)。应用限制网页存储总量为 256 MiB、2000 个条目，收起的资料保留字节、占用配额。不会替换数据库、实例名称或原有绑定。仓库投稿同样限制单文件 10 MiB、总量 256 MiB，以控制静态站点大小。

文件只能以 `application/octet-stream` 附件下载，设置 `nosniff` 与 sandbox CSP；不直接执行上传内容；在线文档通过受限 Markdown / KaTeX 解析器渲染。成员描述和文件名经过 HTML 转义。普通公开清单没有账号、token、内部身份或管理角色；已收起条目仅上传者与档案维护者可见，公开下载地址立即不可用。更名、移动、收起和恢复校验条目版本，防止旧表单覆盖新资料。上传使用幂等标识，同一内容重试不会重复写入。

## API

- `GET /experience`：公开网页投稿清单。带有效成员会话时另返回写入权限和本人可管理的已收起条目。
- `GET /experience/files/x_<32位十六进制ID>`：下载公开文件，不需要登录。
- `POST /experience/upload`：现有成员会话鉴权，JSON `{path, description?, requestId, content}`，`content` 是标准 Base64。最多 30 次上传尝试/账号/小时。
- `POST /experience/manage`：现有成员会话鉴权。创建目录用 `{action:"folder", path}`；整理用 `{action:"edit", id, revision, path, description}`；正文更新用 `{action:"content", id, revision, content}`（UTF-8 256 KiB）；收起或恢复用 `{action:"hide"|"restore", id, revision}`。写入总计最多 100 次尝试/账号/小时。正文与元数据在同一事务更新，更新后仍计入总存储配额。
- 静态仓库清单：`https://sps-club-schedule.github.io/sps-club-schedule/experience-index.json`，文件位于同站点 `experience/<路径>`。

网关只扩展上述固定路由；继续拒绝任意转发目标、查询参数、重定向和上游 HTML 错误，下载仅转发通过附件类型检查的响应。

## 验证与发布

106 项单元/领域/界面测试，47 项 workerd/SQLite 集成测试，4 项网关测试。新检查覆盖多层目录合并、公开查询、成员与其他社团隔离、所有权、并发版本、幂等上传、收起恢复、重启后文件字节一致、10 MiB 边界、非法路径/类型/Base64、构建排除 agent 说明和符号链接、附件响应与网关路由限制。

本地浏览器使用普通成员和专用测试文件验证创建嵌套目录、双文件上传、重命名和说明更新；电脑与 390×844 手机布局截图位于忽略的 `qa/`。没有向生产上传测试文件。发布顺序：原 SPS Worker → 原网关 → GitHub Pages。生产只发布功能、使用说明和空目录。

## 2026-10-30 在线编辑验证

110 项应用测试、47 项 Worker 集成测试、4 项网关测试通过；内容更新覆盖所有权、非成员、旧版本、大小限制、附件类型、字节/hash 更新与重启持久化。Markdown/KaTeX 检查覆盖公式、代码隔离、恶意 HTML/链接、错误提示与按需模块加载。

隔离本地数据库中通过浏览器验证 Markdown 修改保存后重读、新建 `.tex` 矩阵/对齐公式保存、取消导航保留未保存草稿。390px 手机检查无页面横向溢出；截图位于 `qa/experience-editor-desktop.png` 与 `qa/experience-editor-mobile.png`，测试资料未上传生产。生产发布仅修改 Worker 代码、Pages 前端与使用说明，保持原实例与数据库不变。
