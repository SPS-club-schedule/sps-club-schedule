# SPS 社团日程 · Android

独立的 Android WebView 入口，打开现有正式网站：
https://sps-club-schedule.github.io/sps-club-schedule/

本地部分包括桌面图标、启动/断网界面、返回键、文件选择、文本/日历文件保存，以及 Android Keystore 加密的会话和可选账号密码保存。任务、日历、模板、成员与经验档案继续加载线上页面，沿用 `bootstrap.js` 和 `version.json` 的自动更新。没有复制业务页面，不需要为网页日常更新重新发 APK，也没有改动线上网站或服务器。

## 安装和使用

1. 将签名 APK 发到安卓手机，点击安装。按系统提示允许发送该文件的应用安装此 APK。
2. 安装 1.2.0 后，直接在普通登录页输入账号密码并登录即可。页面默认勾选「在这台手机记住密码，下次自动登录」，验证成功后自动加密保存，无需再点顶部入口。取消勾选则只保存有效会话令牌，不保存密码。
3. 后续打开会恢复有效会话；会话过期或服务器要求重新登录时，使用本机保存的密码自动登录并保留社团选择，无需每7天手动输入。顶部显示「自动登录 ✓」。网页账户和任务与浏览器端共用。
4. 网页「退出登录」成功后，会撤销服务器会话并清除本机保存的密码，不会退出后又自动登回去。顶部「自动登录 ✓」可更新或单独清除已保存密码；单独清除密码保留当前有效会话。右上角「清除本机登录与缓存」清除全部本机信息，不删除服务器账号或任务。
5. 已安装 1.0.0 或 1.1.0 的手机直接覆盖安装 1.2.0，无需卸载。已有保存信息继续有效；尚未保存的账号在下次正常登录成功后自动保存。顶部「登录设置」仍可手动管理。

支持 Android 8.0（API 26）以上。系统 WebView 必须支持 `DOCUMENT_START_SCRIPT` 和 `WEB_MESSAGE_LISTENER`；过旧时会提示更新 Android System WebView/Chrome。网页本身也依赖现代浏览器功能，因此建议更新系统 WebView。

服务器单次会话仍为7天；App 使用保存的账号密码获取新会话，不修改服务器期限。网络失败保留密码，自动重试至少间隔1分钟；服务器限流时暂停15分钟；保存的密码被拒绝后清除它并停止自动尝试，避免反复提交旧密码。网页内修改密码后会清除旧密码，下次正常登录时自动保存新密码；注册和恢复密码页面也提供默认勾选的选项，成功后按选择保存。账号切换不会保留上一个账号的密码。App 与手机浏览器的登录容器独立，没有后台推送或离线任务编辑。

文件上传通过系统文件选择器。网页生成的 `.ics`、Markdown、LaTeX 和文本通过系统“保存到”对话框写入（上限 2 MiB）；线上档案附件交给浏览器下载，不索取存储权限。用户可在右上角主动打开浏览器继续使用。

## 会话与安全边界

- 网页当前在 `sessionStorage['sps-web-session']` 保存 `{token, expiresAt, user:{id,username}}`，在 `sps-web-club:<userId>` 保存社团选择。
- 本地 `session-bridge.js` 通过 `WebViewCompat.addDocumentStartJavaScript` 在网页模块运行前恢复会话，并监测这些键的 `setItem`/`removeItem`/`clear`。在认证表单中加入默认勾选的记住密码选项，选择会保留到表单重绘和失败重试后；它不参与网页表单数据，不保存其他草稿。
- 原生侧只接收精确 HTTPS 源、顶层框架、正式入口路径的消息，并再次按字段白名单验证。其他仓库、附件 HTML/SVG、iframe 和外站都不能获得保存在原生侧的会话。附件与外站不在此 WebView 内执行。
- 会话和账号密码分别以 AES-GCM 加密，随机 IV；密钥由 Android Keystore 管理。私有文件中不保存明文令牌、用户名或密码，不参与备份或设备迁移。
- 普通登录只发送网页原有的一次认证请求。只有固定 HTTPS API 的登录、注册或恢复请求返回成功、有效会话且账号匹配时，才将本次提交的账号密码交给受限原生桥加密保存。失败请求、无效响应或外站响应不保存；取消勾选不会把密码交给原生，并在成功登录时清除旧凭据。
- 输入过程中不收集密码。保存后的密码不会回传/注入网页或写入 sessionStorage，也不会记录到日志或打入安装包。原生自动登录继续由 `LoginClient` 通过固定 HTTPS `/auth/login` 发送，拒绝重定向并设置超时；网页仅得到新会话令牌。
- 会话过期只清除令牌，不删除保存的密码。网页成功退出、改密/恢复和原生清除操作分别清理相应内容；网页登录不同账号时不会留下旧账号的自动登录密码。
- 禁止明文 HTTP、混合内容、文件 URL 访问和第三方 cookies，不绕过证书错误。仅申请联网和网络状态权限，无运行时授权弹窗；关闭云备份和设备迁移。发布版关闭 WebView 调试。
- 会话失效由服务器判断，App 不延长令牌期限。网页清除会话后同步移除原生副本；收到身份失效事件且有保存密码时，通过原生登录重新获取会话。
- 如果网站以后改变上述两个存储键或会话格式，需要同时更新这个适配器。普通页面、功能和样式更新不受影响。

Android 官方接口说明：[文档开始注入与按源限制的消息桥](https://developer.android.com/reference/androidx/webkit/WebViewCompat)、[Android Keystore](https://developer.android.com/privacy-and-security/keystore)。

## 构建

需要 JDK 17、Android SDK 36、Build Tools 35.0.0。Gradle Wrapper 固定 8.13 并校验 SHA-256；Android Gradle Plugin 固定 8.13.2。

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

`./gradlew testDebugUnitTest` 测试原生 URL 边界。连接测试用设备/模拟器后，`./gradlew connectedDebugAndroidTest` 验证真实 Android Keystore 加密、损坏/过期处理、WebView 恢复、Activity 重建、退出、iframe 隔离、账号密码保存与自动登录。凭据测试要求关闭测试模拟器的 Wi-Fi 和移动数据，使用替代 HTTP 连接和伪会话，确保测试密码不发送到生产服务。

真实用户设备首轮验收：普通登录（默认记住）→ 顶部显示“自动登录 ✓”→ 划掉 App → 重开 → 验证账号和社团；另外检查取消勾选后不会保存密码；上传一个测试文件、导出个人日历；网页退出 → 重开应显示登录页；断网应显示重试提示；更新网页后重开仍保留有效登录。不同厂商文件选择器与 WebView 应在成员设备上做最后确认。

原生账号密码测试前，在测试模拟器中关闭网络：`adb -s emulator-5554 shell svc wifi disable` 和 `adb -s emulator-5554 shell svc data disable`；结束后将 `disable` 改为 `enable` 恢复。不要对个人正在使用的设备执行这些测试。

## 极简版 1.0.0

使用 `./gradlew -PspsSimple=true testDebugUnitTest lintRelease assembleRelease` 构建独立的「SPS 极简日程」，包名 `org.spsclub.schedule.simple`。签名仍通过上述仓库外配置传入。可与原 App 同时安装，本机登录信息独立；默认进入同一网站的 `?mode=simple#/simple`。

功能、数据对应和发布顺序见 [极简模式说明](../docs/simple-mode.md)。必须先发布网站极简前后端，再分发 App。签名安装包位于 `releases/SPS-Simple-1.0.0.apk`。
