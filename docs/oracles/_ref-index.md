# 判据关系索引

> **本文件由脚本生成，不要手改。** 重新生成：`node <a01>/scripts/oracle-graph.cjs --write`
> 校验是否过期：`node <a01>/scripts/oracle-graph.cjs --check`
>
> 为什么需要它：判据之间是有关系的（父子、同需求、同用例、同承载件、互相引用）。
> 改一条判据前，先在这里查它牵动哪些判据；改完再查一次，确认没有漏改。

判据 31 条 · 关系边：父判据 0 · 正文引用 1 · 共用锚点 0 · 共用承载件 664 · 同批次 756

## 关系检查

| 检查 | 级别 | 命中 |
| --- | --- | ---: |
| G1 悬空引用 | P1 | 0 |
| G2 索引过期 | P1 | 0 |
| G3 父子成环 | P0 | 0 |
| G4 层序颠倒 | P1 | 0 |
| G5 孤立判据 | P1 | 0 |

## 逐条索引

### O-CARD-01 桌面卡片开关 VPN
- 位置: `docs/oracles/90-journeys/10-shell.md:39` · 层: 旅程 · 状态: pending-test
- 上游需求: R-UI-05
- 共用承载件: O-CONN-03 O-CONN-04 O-CONN-07
- 同接收批次(a01-E2E): 27 条

### O-CONN-01 从首页一键连接并进入可用隧道
- 位置: `docs/oracles/90-journeys/02-connection.md:3` · 层: 旅程 · 状态: pending-test
- 上游需求: R-CONN-01 R-CONN-03
- 本判据引用: O-CONN-03
- 共用承载件: O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-CONN-02 从首页一键断开
- 位置: `docs/oracles/90-journeys/02-connection.md:20` · 层: 旅程 · 状态: pending-test
- 上游需求: R-CONN-02
- 共用承载件: O-CONN-01 O-CONN-03 O-CONN-05 O-CONN-06 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-CONN-03 连接后切到其它应用，隧道保持
- 位置: `docs/oracles/90-journeys/02-connection.md:37` · 层: 旅程 · 状态: pending-test
- 上游需求: R-CONN-03
- 引用了本判据: O-CONN-01
- 共用承载件: O-CARD-01 O-CONN-01 O-CONN-02 O-CONN-05 O-CONN-06 O-CONN-07 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-CONN-04 后台掉线自动恢复（非用户主动）
- 位置: `docs/oracles/90-journeys/02-connection.md:54` · 层: 旅程 · 状态: pending-test
- 上游需求: R-CONN-05 R-CONN-06
- 共用承载件: O-CARD-01 O-CONN-07
- 同接收批次(a01-E2E): 27 条

### O-CONN-05 另一个系统 VPN 占用时的冲突处理
- 位置: `docs/oracles/90-journeys/02-connection.md:71` · 层: 旅程 · 状态: pending-test
- 上游需求: R-CONN-07
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-CONN-06 锁屏静置下长时间保持连接
- 位置: `docs/oracles/90-journeys/02-connection.md:88` · 层: 旅程 · 状态: closed
- 上游需求: R-CONN-04 R-CONN-09 R-CONN-10
- 共用承载件: O-CONN-02 O-CONN-03

### O-CONN-07 无 UI 入口独立完成连接
- 位置: `docs/oracles/90-journeys/02-connection.md:106` · 层: 旅程 · 状态: pending-test
- 上游需求: R-CONN-08
- 共用承载件: O-CARD-01 O-CONN-03 O-CONN-04
- 同接收批次(a01-E2E): 27 条

### O-DEV-01 浏览设备列表（含未登录与加载态）
- 位置: `docs/oracles/90-journeys/04-devices.md:3` · 层: 旅程 · 状态: pending-test
- 上游需求: R-DEV-01 R-DEV-02
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-DEV-02 打开设备详情并读取服务与路径
- 位置: `docs/oracles/90-journeys/04-devices.md:20` · 层: 旅程 · 状态: pending-test
- 上游需求: R-DEV-03 R-DEV-04 R-DEV-05 R-DEV-06
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-DIAG-01 解锁诊断并导出脱敏报告
- 位置: `docs/oracles/90-journeys/09-diagnostics.md:5` · 层: 旅程 · 状态: pending-test
- 上游需求: R-DIAG-01 R-DIAG-02 R-DIAG-03 R-DIAG-04 R-DIAG-05 R-NET-04
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-DRIVE-01 浏览并操作 Taildrive 共享目录
- 位置: `docs/oracles/90-journeys/06-taildrive.md:5` · 层: 旅程 · 状态: pending-test
- 上游需求: R-DRIVE-01 R-DRIVE-02 R-DRIVE-03 R-DRIVE-04 R-DRIVE-05
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-DRIVE-02 从设备详情跳转到该设备的共享目录
- 位置: `docs/oracles/90-journeys/06-taildrive.md:22` · 层: 旅程 · 状态: pending-test
- 上游需求: R-DRIVE-06
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-MEDIA-01 探测媒体服务并交给 HosPlayer
- 位置: `docs/oracles/90-journeys/07-media.md:5` · 层: 旅程 · 状态: closed
- 上游需求: R-MEDIA-01 R-MEDIA-02 R-MEDIA-03
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05

### O-MEDIA-02 经 Sunshine/Moonlight 串流
- 位置: `docs/oracles/90-journeys/07-media.md:22` · 层: 旅程 · 状态: pending-test
- 上游需求: R-MEDIA-04 R-MEDIA-05
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-NET-01 连接前选择出口节点
- 位置: `docs/oracles/90-journeys/03-network.md:3` · 层: 旅程 · 状态: pending-test
- 上游需求: R-NET-01
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-NET-02 配置子网路由与出口节点允许访问局域网
- 位置: `docs/oracles/90-journeys/03-network.md:20` · 层: 旅程 · 状态: pending-test
- 上游需求: R-NET-02
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-NET-03 网络切换后同会话恢复直连
- 位置: `docs/oracles/90-journeys/03-network.md:37` · 层: 旅程 · 状态: closed
- 上游需求: R-NET-03

### O-PRIV-01 应用锁：开启、回前台锁定、认证失败不放行
- 位置: `docs/oracles/90-journeys/08-privacy.md:5` · 层: 旅程 · 状态: pending-test
- 上游需求: R-PRIV-01 R-PRIV-02
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-PRIV-02 Taildrive 文件夹锁
- 位置: `docs/oracles/90-journeys/08-privacy.md:22` · 层: 旅程 · 状态: pending-test
- 上游需求: R-PRIV-03 R-PRIV-04
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-SETUP-01 首次启动：欢迎与更新日志
- 位置: `docs/oracles/90-journeys/01-setup.md:3` · 层: 旅程 · 状态: pending-test
- 上游需求: R-SETUP-01 R-SETUP-02
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-SETUP-02 配置控制服务器（含明文 HTTP 确认）
- 位置: `docs/oracles/90-journeys/01-setup.md:20` · 层: 旅程 · 状态: pending-test
- 上游需求: R-SETUP-03 R-SETUP-04 R-SETUP-05
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-SETUP-03 经系统浏览器登录 Tailscale
- 位置: `docs/oracles/90-journeys/01-setup.md:37` · 层: 旅程 · 状态: pending-test
- 上游需求: R-SETUP-06 R-SETUP-07
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-SETUP-04 退出登录（须先断开）
- 位置: `docs/oracles/90-journeys/01-setup.md:54` · 层: 旅程 · 状态: pending-test
- 上游需求: R-SETUP-08 R-SETUP-09
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-UI-01 页签导航与显隐排序
- 位置: `docs/oracles/90-journeys/10-shell.md:5` · 层: 旅程 · 状态: pending-test
- 上游需求: R-UI-01 R-UI-02
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-UI-02 中英双语与深浅主题
- 位置: `docs/oracles/90-journeys/10-shell.md:22` · 层: 旅程 · 状态: pending-test
- 上游需求: R-UI-03 R-UI-04
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-XFER-01 从传输页发送文件
- 位置: `docs/oracles/90-journeys/05-transfer.md:3` · 层: 旅程 · 状态: pending-test
- 上游需求: R-XFER-01 R-XFER-02
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-02 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-XFER-02 发送文字并在接收端预览
- 位置: `docs/oracles/90-journeys/05-transfer.md:20` · 层: 旅程 · 状态: pending-test
- 上游需求: R-XFER-03
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-03 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-XFER-03 从设备详情走双通道发送
- 位置: `docs/oracles/90-journeys/05-transfer.md:37` · 层: 旅程 · 状态: pending-test
- 上游需求: R-XFER-08 R-XFER-09
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-04 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-XFER-04 接收文件并按类型落地
- 位置: `docs/oracles/90-journeys/05-transfer.md:54` · 层: 旅程 · 状态: pending-test
- 上游需求: R-XFER-05 R-XFER-06 R-XFER-07
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-05
- 同接收批次(a01-E2E): 27 条

### O-XFER-05 传输的取消、重试与历史上限
- 位置: `docs/oracles/90-journeys/05-transfer.md:71` · 层: 旅程 · 状态: pending-test
- 上游需求: R-XFER-04 R-XFER-10
- 共用承载件: O-CONN-01 O-CONN-02 O-CONN-03 O-CONN-05 O-DEV-01 O-DEV-02 O-DIAG-01 O-DRIVE-01 O-DRIVE-02 O-MEDIA-01 O-MEDIA-02 O-NET-01 O-NET-02 O-PRIV-01 O-PRIV-02 O-SETUP-01 O-SETUP-02 O-SETUP-03 O-SETUP-04 O-UI-01 O-UI-02 O-XFER-01 O-XFER-02 O-XFER-03 O-XFER-04
- 同接收批次(a01-E2E): 27 条

