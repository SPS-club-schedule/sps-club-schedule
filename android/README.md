# SPS 社团日程 · Android

1.4.0 将完整前端随 APK 安装：页面、脚本、样式、字体和仓库经验档案由本机提供，任务、账号和预约数据直接访问原 HTTPS 后端。启动不再依次下载网站 HTML、版本清单和前端资源；断网也能打开极简日历界面，实际数据更新和任务操作仍需要联网。保存密码的自动登录在界面显示后异步进行。

两种模式共用一个 App。App 顶部原生按钮负责切换模式，内置页面隐藏下载 App、分享 ZIP 和重复的模式切换按钮；浏览器网站保留这些入口。前端与网站共用源码，在构建时生成不同平台的资源，App 页面更新需要安装新版 APK，不再热更新网页。

## 安装和使用

1. 安装签名的 `SPS-Schedule-1.4.0.apk`（也可解压同名微信分享 ZIP），首次直接进入极简公开预约日历，无需登录。
2. 顶部「极简模式 ▾ / 完整模式 ▾」按钮可选择显示模式。选择保存在设备上，关闭、重开或退出账号后仍保留。选完整模式且未登录时会要求登录；选极简模式可继续游客浏览。
3. 在极简日历点击「登录」会在成功后返回极简日历，并显示个人任务。普通登录页默认勾选「在这台手机记住密码，下次自动登录」，成功后加密保存；取消勾选只保存有效会话。
4. 网页退出登录后会撤销服务器会话并清除保存的密码。原生右上角菜单的「登录设置 / 管理自动登录」可管理保存的密码；「清除本机登录与缓存」清除登录与网页缓存，显示模式保留。
5. 原完整版 1.0–1.2 和统一版 1.3.0 可直接覆盖升级为 1.4.0，保留本机登录与模式选择。旧独立极简版包名不同，需改装此统一版并重新登录；账号和服务器任务沿用，不需要迁移。两个安装包的本机存储不会自动合并。

支持 Android 8.0（API 26）以上。系统 WebView 必须支持 `DOCUMENT_START_SCRIPT` 和 `WEB_MESSAGE_LISTENER`；过旧时会提示更新 Android System WebView/Chrome。网页本身也依赖现代浏览器功能，因此建议更新系统 WebView。

服务器单次会话仍为7天；App 使用保存的账号密码获取新会话，不修改服务器期限。网络失败保留密码，自动重试至少间隔1分钟；服务器限流时暂停15分钟；保存的密码被拒绝后清除它并停止自动尝试，避免反复提交旧密码。网页内修改密码后会清除旧密码，下次正常登录时自动保存新密码；注册和恢复密码页面也提供默认勾选的选项，成功后按选择保存。账号切换不会保留上一个账号的密码。App 与手机浏览器的登录容器独立，没有后台推送或离线任务编辑。

文件上传通过系统文件选择器。网页生成的 `.ics`、Markdown、LaTeX 和文本通过系统“保存到”对话框写入（上限 2 MiB）；线上档案附件交给浏览器下载，不索取存储权限。用户可在右上角主动打开浏览器继续使用。

## 会话与安全边界

- `WebViewAssetLoader` 在原站点 HTTPS 源及路径提供 APK 中的资源，保留既有 CORS、会话和链接语义。只允许签名包资源清单中的文件；缺失路径返回 404，不回退加载网上的新脚本，也不暴露原生桥源码。独立后端域名的请求直接联网。
- 显示模式保存在原生 `display-mode` 首选项，并在文档启动时注入 `localStorage['sps-display-mode']`。网页切换仅发送 `simple` / `full`，原生验证来源及值后写入；与会话存储隔离，退出登录不清除。
- 网页当前在 `sessionStorage['sps-web-session']` 保存 `{token, expiresAt, user:{id,username}}`，在 `sps-web-club:<userId>` 保存社团选择。
- 本地 `session-bridge.js` 通过 `WebViewCompat.addDocumentStartJavaScript` 在网页模块运行前恢复会话，并监测这些键的 `setItem`/`removeItem`/`clear`。在认证表单中加入默认勾选的记住密码选项，选择会保留到表单重绘和失败重试后；它不参与网页表单数据，不保存其他草稿。
- 原生侧只接收精确 HTTPS 源、顶层框架、正式入口路径的消息，并再次按字段白名单验证。其他仓库、附件 HTML/SVG、iframe 和外站都不能获得保存在原生侧的会话。附件与外站不在此 WebView 内执行。
- 会话和账号密码分别以 AES-GCM 加密，随机 IV；密钥由 Android Keystore 管理。私有文件中不保存明文令牌、用户名或密码，不参与备份或设备迁移。
- 普通登录只发送网页原有的一次认证请求。只有固定 HTTPS API 的登录、注册或恢复请求返回成功、有效会话且账号匹配时，才将本次提交的账号密码交给受限原生桥加密保存。失败请求、无效响应或外站响应不保存；取消勾选不会把密码交给原生，并在成功登录时清除旧凭据。
- 输入过程中不收集密码。保存后的密码不会回传/注入网页或写入 sessionStorage，也不会记录到日志或打入安装包。原生自动登录继续由 `LoginClient` 通过固定 HTTPS `/auth/login` 发送，拒绝重定向并设置超时；网页仅得到新会话令牌。
- 会话过期只清除令牌，不删除保存的密码。网页成功退出、改密/恢复和原生清除操作分别清理相应内容；网页登录不同账号时不会留下旧账号的自动登录密码。
- 禁止明文 HTTP、混合内容、文件 URL 访问和第三方 cookies，不绕过证书错误。仅申请联网和网络状态权限，无运行时授权弹窗；关闭云备份和设备迁移。发布版关闭 WebView 调试。
- 会话失效由服务器判断，App 不延长令牌期限。网页清除会话后同步移除原生副本；收到身份失效事件且有保存密码时，通过原生登录重新获取会话。
- 如果以后改变上述两个存储键或会话格式，需要同时更新这个适配器。发布前端功能或样式修改时，网站正常部署，App 另外构建并发布新版 APK；后端接口需继续兼容已安装的版本。

Android 官方接口说明：[加载本地前端资源](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)、[文档开始注入与按源限制的消息桥](https://developer.android.com/reference/androidx/webkit/WebViewCompat)、[Android Keystore](https://developer.android.com/privacy-and-security/keystore)。

## 构建

需要 Node.js 22、JDK 17、Android SDK 36、Build Tools 35.0.0，先在仓库根目录执行 `npm ci`。Gradle Wrapper 固定 8.13 并校验 SHA-256；Android Gradle Plugin 固定 8.13.2。

Gradle 的 `preBuild` 自动执行 `node scripts/build.mjs --android`，将前端打到忽略的 `android/app/build/generated/webAssets`。也可运行 `npm run build:android` 单独检查；构建固定使用正式后端地址，不受网页开发环境的 localhost 配置影响。APK 不包含网站下载目录，因此不会将其他 APK/ZIP 递归打入包内。

设置 `JAVA_HOME` 和 `ANDROID_HOME`（或在忽略的 `local.properties` 中指定 `sdk.dir`），然后：

```sh
cd android
./gradlew testDebugUnitTest assembleDebug
```

签名信息放在仓库外的属性文件，通过 `SPS_ANDROID_SIGNING_PROPERTIES` 指定绝对路径；也可使用忽略的 `android/signing.properties`。属性为 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`。不得提交或分发密钥及密码。

```sh
./gradlew testDebugUnitTest lintRelease assembleRelease
```

签名配置缺失时 Gradle 会产出 **unsigned** APK，不能作为正式安装包分发。必须使用相同签名密钥，并递增 `versionCode`，才能覆盖升级已安装的 App。妥善备份密钥和签名配置，勿将它们与 APK 一起发给成员。

## 验证

仓库根目录 `npm test` 包括实际网页 `client/api.js` 与原生注入脚本的集成测试：登录、重新打开、社团选择、退出失败/成功、过期、清空、白名单字段和框架/源隔离。

`./gradlew testDebugUnitTest` 测试原生 URL 边界。连接测试用设备/模拟器后，`./gradlew connectedDebugAndroidTest` 验证真实 Android Keystore 加密、损坏/过期处理、WebView 恢复、Activity 重建、退出、iframe 隔离、账号密码保存与自动登录，以及断网加载内置日历、缺失资源不回退联网、App 内入口精简和模式重开恢复。凭据测试要求关闭测试模拟器的 Wi-Fi 和移动数据，使用替代 HTTP 连接和伪会话，确保测试密码不发送到生产服务。

真实用户设备首轮验收：首次不登录进入日历 → 选择完整模式并登录 → 划掉 App → 重开保持完整模式和会话 → 改选极简 → 退出账号 → 重开仍为极简游客日历。再检查取消记住密码、上传/导出、断网重试及不同厂商的 WebView 手势。

原生账号密码测试前，在测试模拟器中关闭网络：`adb -s emulator-5554 shell svc wifi disable` 和 `adb -s emulator-5554 shell svc data disable`；结束后将 `disable` 改为 `enable` 恢复。不要对个人正在使用的设备执行这些测试。

## 历史独立极简版

独立极简版 1.0.0 的包名为 `org.spsclub.schedule.simple`。从 1.3.0 起不再使用 `-PspsSimple=true` 创建新分支，统一发布 `org.spsclub.schedule`，在 App 内切换模式。历史安装包仍保留原下载 URL。
