# VPN 常驻、断连恢复与省电 · 设计增量

- 流程版本：a01（第 01 版）
- 变更 ID：`vpn-endurance`
- 代码基线：`ec64476`（分支 `local-build`）
- 上层输入：`docs/requirements/requirements.md`（R-CONN-11…13、R-NET-05、R-POWER-01/02）、
  `docs/architecture/architecture.md`（§2.6、§五 O-CONN-08、O-SEAM-19）、`docs/hld/hld.md`（C-11、C-03、C-15、C-19）
- 本文件只记录**本批次新增或修订**的设计，不复制既有四层文档。既有条目以各文档正文为准。

## 一、目标与边界

| 目标 | 用户可见结果 | 判据 |
| --- | --- | --- |
| 常驻 | 用户不点停止，连接一直可用 | O-CONN-08、O-CONN-09 |
| 留证 | 每次非用户断连都有原因记录 | O-DIAG-02 |
| 恢复 | 网络恢复后自动恢复，无需用户操作 | O-CONN-09、O-NET-04 |
| 省电 | 后台与熄屏不再全速计算 | O-POWER-01、O-POWER-02 |

边界：

- 不申请新的权限。`ohos.permission.GET_NETWORK_INFO` 已在 `module.json5` 声明，够读取默认网络。
- 不改引擎。恢复走现有的 `VpnSessionController`，不新开编排。
- 不改卡片的 5 s 轮询。卡片进程由系统调度，代码不在应用常驻管辖内。

## 二、设计要点

### 2.1 意图文件：唯一意图来源

新增 `filesDir/vpn-intent.json`：

```json
{ "desired": "connected", "changedAtMs": 1792478979888, "by": "ui" }
```

写入方：

| 写入方 | 时机 | by |
| --- | --- | --- |
| `BridgeStatus.beginVpnConnection` | 用户点击连接，命令状态机 begin 返回非零、写命令文件之前 | `ui` |
| `BridgeStatus.stopVpnProbe` | 用户点击停止，先写账本 `user_stop`、再写意图、最后写停止请求 | `ui` |
| `EntryAbility.performCardToggle` → `VpnSessionController.connect` | 卡片切换为连接 | `card` |
| `EntryAbility.performCardToggle` → `VpnSessionController.disconnect` | 卡片切换为停止 | `card` |
| `VpnSessionController.disconnect` | 恢复撤销自身刚建的隧道 | `recovery` |

读取方：`VpnBackgroundTaskManager`、`VpnReconnectSupervisor`。P2 不读意图，只写会话账本与状态文件。

规则：

1. 文件缺失或损坏按 `stopped` 处理。理由：宁可少恢复，不在用户不知道时建隧道。
2. 一次状态判读不能改变意图。只有上表的写方可以改意图。
3. 意图写入与用户动作同一同步步骤，先写意图再写命令文件。这样恢复看门狗读到的意图晚于用户的点击。
4. 恢复连接不重写意图。恢复只在意图已是 `connected` 时启动，重写会覆盖这期间到达的用户停止。

### 2.2 长时任务的意图守卫

`VpnBackgroundTaskManager.reconcile` 的判据从「状态 live」改为「意图 + 状态」：

```text
if intent == stopped:
    释放任务（若持有）
    return
if 状态 == disconnected:
    写账本（如未写），交给恢复看门狗
    任务不立即释放；等恢复或意图变为 stopped
if 状态 == unknown:
    任务保留。本轮不做任何释放
else:
    任务保留或申请
```

释放路径只剩三条：

1. 意图变为 `stopped`。
2. 系统取消且用户取消。后台不重抢，回前台且意图仍为 `connected` 时重新申请。
3. 生命周期销毁（`unregister`）。

`suppressedUntilDisconnect` 更名为 `suppressedUntilForeground`，语义从「直到断开」改为「直到回前台」。

### 2.3 会话账本

P1 写 `filesDir/vpn-session-ledger-ui.ndjson`，P2 写 `filesDir/vpn-session-ledger-vpn.ndjson`。读取时按时间合并并去重。字段与原因词表见 HLD C-19。

| 写方 | 事件 | 触发点 |
| --- | --- | --- |
| P2 | `vpn_session_end(extension_destroyed)` | `onDestroy` 第一行 |
| P2 | `vpn_session_end(handoff_timeout)` | `requestUiBackendHandoff` 15 s 超时分支 |
| P1 | `vpn_session_end(user_stop)` | 用户入口（界面的停止、卡片的停止），先于命令文件写入 |
| P1 | `vpn_session_end_observed(<reason>)` | 心跳停止或读到 P2 的结束记录 |
| P1 | `vpn_session_recovered` | 恢复后连接稳定 60 s |

`system_stopped` 与 `network_lost` 保留在词表内，当前没有能可靠区分它们的证据点。系统停止扩展时同样走 `onDestroy`，
记为 `extension_destroyed`；进程被杀且没有结束记录时，P1 记为 `extension_crash`，阶段写 `heartbeat_expired`。

恢复撤销不写账本、不写意图。它只停自己刚建起的扩展。用户停止时由用户入口先写 `user_stop` 与 `stopped`；
用户重新连接时意图已是 `connected`，撤销不得改写。

`sessionId`：P2 在 `onCreate` 生成 `Date.now()`，写进 `vpn-probe-status.txt` 的 `sessionId=` 字段。
P1 用它给账本去重。

账本上限：512 条或 64 KB，先到者为准，淘汰最旧。上限比诊断事件高，因为断连是低频事件。

### 2.4 恢复状态机

```text
        意图 connected
              │
              ▼
        ┌─ CHECK_NETWORK ─┐
        │  netId == 0     │  netId != 0
        │       │         ▼
        │       ▼      RECOVER (VpnSessionController.connect)
        │   DEFERRED       │
        │  （等回调，      ├─ STARTED → 稳定 60 s → IDLE(意图仍 connected)
        │   不计次数）     ├─ NEEDS_UI → 写账本，IDLE
        └───────┘         └─ FAILED  → 退避 30/60/120/300 s 封顶
```

要点：

- 不设次数上限。用户没有停止时一直重试。退避封顶 300 s，避免无谓唤醒。
- 状态为 unknown 且没有心跳时，30 s 从意图的 `changedAtMs` 起算。这样轮询不会与用户刚发起的连接竞争。
- 在途恢复在每个检查点重读意图文件。用户在页面停止时不经过监督器对象，
  所以取消权来自文件，不来自方法调用。令牌为正向：true 表示仍有授权。
- 恢复返回 `NEEDS_UI` 后停止自动重试。意图文件的 `changedAtMs` 变新时，
  说明用户已在页面重新操作，恢复自动重试。
- 网络离线不消耗尝试次数。网络恢复时立即触发一次，不等退避到期。
- 用户回到前台时清零退避。
- 每次发起恢复写一条 `vpn_session_recovery_attempt`，包含尝试序号。这是用户要求「断连都要记录」的一部分。
- P1 新增 `connection.NetConnection` 监听。它只注册 `netAvailable`，把回调转给恢复看门狗。
  它不读取地址，也不发重绑。

### 2.5 省电档位

| 档位 | 判定 | 扩展命令环 | 扩展状态环 | 扩展快照 | UI 服务刷新 | UI 首页延迟 | UI 详情页 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| active | 应用在前台 | 100 ms | 1 s | 1 s | 30 s | 2 s | 2 s |
| background | 应用在后台 | 250 ms | 2 s | 2 s | 停止 | 停止 | 停止 |
| screen-off | 应用在后台且屏幕熄灭 | 1000 ms | 5 s | 15 s | 停止 | 停止 | 停止 |

判定来源：

- 前台/后台：`EntryAbility.onForeground` / `onBackground`（既有）。
- 屏幕：`power.isActive()`（`@kit.BasicServicesKit`），有屏设备亮屏为 true。P1 每 30 s 检查一次，变化时写
  `filesDir/vpn-power-stage.json`。P2 每轮读取它。
- 档位文件缺失时按 `active` 处理。宁可多算，不以错误猜测降低功能。
- P2 在状态环每轮重读档位文件。档位变化时按新间隔重建命令环与状态环。状态环最长 5 s，
  三拍不超过 15 s 的状态新鲜度上限。

保持不变的项：

- 隧道本身、网络重绑、恢复看门狗：不降频。
- 停止请求的文件监听（`fileIo.createWatcher`）：不变。
- 账本写入：不变。

### 2.6 UI 侧省电

`BridgeStatus` 现有定时器的处理：

| 定时器 | 处理 |
| --- | --- |
| `healthPollTimer`（1 s） | 后台保留。它驱动恢复判定，不能停 |
| `serviceRefreshTimer`（30 s） | 后台停止，回前台恢复 |
| `homeLatencyRefreshTimer`（2 s） | 后台停止 |
| `deviceDetailRefreshTimer`（2 s） | 后台停止 |
| `transferProtocolRefreshTimer`（2 s） | 后台停止 |
| `offlinePeerStatusRefreshTimer`（10 s） | 后台停止 |
| `connectionDurationTimer`（1 s） | 只在详情页可见时运行，已自适应 |
| `cardTimer`（5 s） | 保留。卡片是用户可见入口 |

停止与恢复的调用点：`EntryAbility.onBackground` / `onForeground` 通过 `eventHub` 发
`APP_BACKGROUND_EVENT` / `APP_FOREGROUND_EVENT`。`BridgeStatus` 已监听前台事件，补一个后台事件。

### 2.7 恢复后的一致性

恢复成功后，以下状态必须刷新，避免界面显示旧值：

- `bridgeStatus`：重新读引擎状态。
- `vpnStatus`：下一轮 1 s 轮询自然刷新。
- 对端快照：`refreshPeerSnapshot` 立即执行一次。
- 流量会话：`trafficSession` 变化时清零流量计量。既有逻辑已处理。

## 三、接口与文件

| 文件 | 新增或修改 | 内容 |
| --- | --- | --- |
| `services/VpnSessionIntent.ets` | 新增 | 意图文件读写的唯一入口 |
| `services/SessionLedger.ets` | 新增 | 账本追加、去重、上限、原因词表 |
| `services/VpnPowerPolicy.ets` | 新增 | 档位判定、档位文件读写 |
| `services/VpnBackgroundTaskManager.ets` | 修改 | 意图守卫、抑制语义、释放路径 |
| `services/VpnReconnectSupervisor.ets` | 修改 | 恢复状态机、网络等待、取消次数上限 |
| `services/VpnSessionController.ets` | 修改 | 写意图、写账本、恢复后刷新 |
| `vpnextensionability/TailscaleVpnExtensionAbility.ets` | 修改 | `sessionId`、结束记录、三档定时器 |
| `entryability/EntryAbility.ets` | 修改 | 屏幕状态采样、档位文件、后台事件广播 |
| `components/BridgeStatus.ets` | 修改 | 后台事件处理、定时器停止与恢复 |
| `services/StoragePaths.ets` | 修改 | 新增四个文件路径常量：意图、账本、最近结束、档位 |

## 四、失败模式与处置

| 失败模式 | 处置 | 判据 |
| --- | --- | --- |
| 意图文件写失败 | 记 `vpn_intent_write_failed`。恢复看门狗按旧意图处理。用户动作仍照常执行 | O-SESSION-09 |
| 账本写失败 | 不阻止退出，记 hilog | C-19 |
| 档位文件写失败 | P2 保持上一档 | O-POWER-01 |
| P1 被冻结 | 意图与账本在冻结前已落盘。解冻后 P1 读账本补写观测 | O-CONN-08 不确定特征 |
| 恢复抢在用户停止之前 | 意图已是 `stopped`，恢复的授权检查不启动扩展 | O-RECONN-10（既有） |
| 两个进程同时写账本 | NDJSON 追加，去重按 `sessionId + kind` | C-19 |

## 五、对既有判据的修订

| 判据 | 修订 |
| --- | --- |
| O-RECONN-05 | 「最多 3 次后放弃」改为「不设上限，退避封顶 300 s」 |
| O-BGTASK-02 | 「宽限 60 s 后释放」改为「状态不确定不释放，释放只看意图」 |
| O-BGTASK-06 | 「用户取消后同会话内不恢复」改为「后台不重抢，回前台且意图仍在时重新申请」 |
| O-BGTASK-15 | 「停滞的连接窗口超过宽限仍释放保护」改为「停滞的连接窗口不释放，交给恢复看门狗」 |
| O-BGTASK-04 | 「读到显式断开即刻释放」改为「意图为 stopped 时才释放；意图为 connected 时保留，交给恢复看门狗」 |
| O-BGTASK-10 | 启动在途时的中断加入「意图变为 stopped」；只读到 disconnected 而意图仍 connected 不算中断 |
| O-RECONN-02 | 「前台可见或刚进入后台的掉线视为用户主动」改为「意图为 connected 时，掉线一律进入恢复。前台可见时立即恢复，不等 10 s」 |
| O-STATUS 系列 | 新增 `sessionId` 字段的解析，不改变状态判定 |

修订理由全部来自用户要求「用户没有点击停止时，不要停止连接」。旧判据守的是「不确定时宁可少恢复」，与这条冲突。
