# MeshArc 接缝判据 · 构建与产物装配（O-SEAM-18）

本文件覆盖「构建与产物装配」这一条接缝。构建机是边界外的一方。它按脚本契约取走源码与补丁，交回可装配的产物。
`期望` 只写输入、产物与责任怎么交出去，不写用户看到什么。

审查人修订 Q16b（2026-10-13）。原裁决（2026-10-12）不为构建另立接缝。原裁决让 7 条构建单点判据直连旅程
`O-BUILD-00`，并逐条写 `seam_not_applicable`。这个选择与 a01 的工具规则冲突：单点判据就绪时必须引用 HLD
或 LLD 设计条目，而构建流程当时没有承载件。本次修订撤销原裁决。构建流程获得 HLD 契约 `C-18` 与 LLD 条目
`L-BUILD`。所以它是一条接缝。

### O-SEAM-18 构建与产物装配
- 层级：接缝
- 父判据：O-BUILD-00
- 强度：强
- 设计依据：架构 §2.2 子系统 S9（构建与交付：交叉编译引擎、装配 HAP、产物校验）、§3.3 部署视图（产物形态与可安装性）；需求 R-BUILD-01「产物必须是 AArch64 动态库且被正确打进 HAP」、R-BUILD-02「构建脚本对参数与路径的处理可被测试守住」；架构 A-SEAMS
- 触发与前置条件：开发者在 macOS、Linux 或 Windows 上运行构建入口。macOS 与 Linux 的入口是 `scripts/build.sh` 和 `.build/compile.sh`。Windows 的入口是 `scripts/build.ps1`。三者的第一步都是 `scripts/build-go.sh` 或它的 Windows 对应物。
- 可观测点：两次连续执行的退出码与 stdout（`Applied patch` 或 `Patch already applied`）。传给 `go` 的实参（`-buildmode=c-shared`、`-trimpath`、两个 `-X` 版本戳）。`entry/libs/arm64-v8a/libtailscale_go.so` 与 `libtailscale_go.h` 是否落位。传给 node 的装配参数（`hvigorw.js`、`buildMode=debug`、`debuggable=true`、`assembleHap`）。非 default 产品时的退出码与 stderr 文案。
- 期望：正常：开发者在仓库根运行入口。入口先应用两棵源码树上的补丁。`apply_patch` 先做 `git apply --reverse --check`，失败才把补丁 `git apply` 进树（`scripts/build-go.sh:60-64`）。然后 `go build -buildmode=c-shared` 编译出 AArch64 动态库（`scripts/build-go.sh:86-89`）。脚本把 `.so` 与 `.h` 复制进 `entry/libs/arm64-v8a/`（`scripts/build-go.sh:43-45`、`:91-92`）。最后 hvigor 用 wrapper 与显式 debug 参数装配 HAP（`scripts/build.sh:53-59`）。边界：补丁已应用时脚本判定幂等并继续，不重复叠加（`scripts/build-go.sh:60-61`）。补丁落两棵不同的树。`patches/ohos-go-interface-resources.patch` 落 Go 工具链源码树 `$go_root`，默认 `~/.ohos-go-build/ohos-go`，回退 `third_party/ohos-go`。`patches/tailscale-ohos.patch` 落 `third_party/tailscale`（`scripts/build-go.sh:15-20`、`:67-68`）。工程目录含空格时引号处理仍成立。失败与恢复：补丁冲突时 `git apply` 非零退出，`set -euo pipefail` 让脚本在编译前中止（`scripts/build-go.sh:10`）。补丁文件缺失时脚本报错退出（`scripts/build-go.sh:56-59`）。非 default 产品在 macOS 入口开头被拒（`scripts/build.sh:6-12`）。Windows 入口只接受 `default` 与 `release`（`scripts/build.ps1:1-4`）。安全与质量：两个版本戳都取自同一版本号 1.86.5（`scripts/build-go.sh:88`）。`-trimpath` 让产物路径不含构建机目录。命令与路径全部加引号。
- 失败信息：期望「补丁幂等应用，AArch64 产物落进 entry/libs/arm64-v8a，非 default 产品在装配前被拒」，实际「补丁被叠两次，或冲突后继续编译，或产物缺 .h，或 Release 与未知产品在 macOS 入口静默产出」
- 来源：scripts/build-go.sh:10 set -euo pipefail。:15-20 go_root 定位与回退。:43-45 output_dir 与 hap_lib_dir 的 mkdir -p。:54-66 apply_patch，:60 reverse-check，:63 应用。:67-68 两棵源码树的补丁。:86-89 go build c-shared 与 ldflags 的两个 -X。:91-92 复制 .so 与 .h。scripts/build.sh:6-12 产品门与 stderr 文案。:13 cd 工程根。:51 调用 build-go.sh。:53-59 hvigor wrapper 与 debug 参数。:61 HAP 输出路径。scripts/build.ps1:1-4 产品 ValidateSet。:126-132 release 的 changelog 校验。:134-135 buildMode 与 debuggable 由产品派生。:187-198 HAP 发现与 verify-artifacts。.build/compile.sh:20-26 两级流程。patches/ohos-go-interface-resources.patch。patches/tailscale-ohos.patch。docs/hld/hld.md 契约 C-18
- 上游：R-BUILD-01、R-BUILD-02
- 待建测试：[集成] scripts/integration/build-flow.mjs::补丁幂等且产物落进 entry/libs/arm64-v8a 而非 default 产品在装配前被拒
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-集成
- 复核：待复核
