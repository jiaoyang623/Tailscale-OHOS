# MeshArc 旅程判据 · 隐私区（应用锁 / 文件夹锁）

本文件覆盖「隐私」区的两条旅程：应用锁，以及 Taildrive 文件夹锁。

### O-PRIV-01 应用锁：开启、回前台锁定、认证失败不放行
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-PRIV-01「应用锁开启与关闭都要经过系统认证；开启后回到前台即锁定」、R-PRIV-02「认证失败停在锁定层可重试，不得放行」
- 触发与前置条件：已登录，用户在设置 > 安全里切换「应用锁」开关；应用锁已开启时，应用从后台回到前台
- 可观测点：系统认证组件弹出的认证界面、锁定层 `security-app-lock-overlay`、认证失败文案、以及诊断事件 `app_lock_*`
- 期望：正常：切换应用锁开关必须先通过系统认证（ATL2，使用已录入的 FACE/FINGERPRINT/PIN 之一），通过后才写入并生效；已开启时每次回到前台或安全偏好加载完成后立即置锁定并显示覆盖全屏的锁定层，该层同样盖住更新日志等原生弹层。边界：没有可用认证方式时不放行也不误报成功；认证进行中重复触发被忽略（认证中守卫）。失败与恢复：认证失败或抛异常时停留在锁定层，显示认证失败文案并可点「解锁应用」重试；失败不得清除锁定标志。安全与质量：只用系统认证组件，不保存任何凭据或 AuthToken；关闭应用锁同样需要认证。
- 失败信息：期望「认证未通过时保持锁定、界面内容不可见」，实际「锁定层被跳过，内容在未认证时可见」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:1277 requireAppAuthentication；:1286 authenticateApplication；:1301-1308 通过与失败分支；:1318 setAppLockEnabled；:1325 updateAppLockEnabled；:1071-1072 handleAppForeground；:1254 loadSecurityPreferences；:14957 AppLockOverlay；:15139 bindContentCover；entry/src/main/ets/services/AppSecurityAuthenticator.ets:9 AUTH_TRUST_LEVEL=ATL2；:13 authenticate；:66-84 availableAuthTypes
- 上游：R-PRIV-01、R-PRIV-02
- 待建测试：[E2E] scripts/e2e/security-locks.mjs::应用锁开启与回前台锁定
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核

### O-PRIV-02 Taildrive 文件夹锁
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-PRIV-03「被锁的 Taildrive 路径在解锁前不得渲染内容，且锁定时清空已显示的内容」、R-PRIV-04「回到前台即清除文件夹授权，需要重新认证」
- 触发与前置条件：已连接，用户在设置 > 安全开启「文件夹锁」并指定受保护路径；随后进入该受保护路径，或已解锁状态下切后台再回前台
- 可观测点：TaildriveBrowser 列表是否清空、受保护根是否在授权集合内、系统认证弹窗、文件夹锁开关 `security-folder-lock-toggle`、诊断事件 `folder_access_*` 与 `folder_lock_*`
- 期望：正常：进入受保护目录前必须先通过系统认证，通过后该根才加入授权集合并渲染内容。边界：未认证时清空列表、缩略图与选择态，只保留目录骨架；回到前台无条件清空授权并重新上锁，随后重试认证；开启文件夹锁本身也要经系统认证。失败与恢复：认证失败显示文件夹认证失败并退回受保护根的上层，不渲染被锁内容；重复回前台可重复触发认证。安全与质量：锁定时已显示的内容被立即清空，不残留在界面里。
- 失败信息：期望「回到前台后受保护目录内容不可见」，实际「返回后仍能看到先前渲染的受保护内容」
- 来源：entry/src/main/ets/components/BridgeStatus.ets:1357 setFolderLockEnabled；:1364 updateFolderLockEnabled；:13975-13979 开关；entry/src/main/ets/components/TaildriveBrowser.ets:320 handleAppForeground；:321 清空授权；:325 blockProtectedFolderContent；:666 blockProtectedFolderContent；:703 ensureFolderAccess；:189 appForegroundListener
- 上游：R-PRIV-03、R-PRIV-04
- 待建测试：[E2E] scripts/e2e/security-locks.mjs::Taildrive 文件夹锁
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核
