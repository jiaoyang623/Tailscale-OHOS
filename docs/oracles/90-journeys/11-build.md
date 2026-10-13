# MeshArc 旅程判据 · 开发者构建流程（O-BUILD-00）

### O-BUILD-00 开发者构建流程：打补丁、编译引擎、装配 HAP
- 层级：旅程
- 父判据：无（旅程层没有父判据）
- 强度：强
- 设计依据：需求 R-BUILD-01「产物必须是 AArch64 动态库且被正确打进 HAP」、R-BUILD-02「构建脚本对参数与路径的处理可被测试守住」
- 触发与前置条件：开发者在 macOS 或 Linux 上从仓库根目录运行 `scripts/build.sh`。**这是一条开发者旅程，不是用户旅程**。本项目把构建脚本当作第一类流程，所以为它单列旅程判据。审查人裁决 Q16b（2026-10-12）：不为构建另立接缝，7 条构建单点判据直连本条。
- 可观测点：两次连续执行的退出码与 stdout（Applied patch 与 Patch already applied）、`third_party/tailscale/source.txt` 的内容、传给 `go` 的 argv 里的两个版本戳、`entry/libs/arm64-v8a/libtailscale_go.so` 与 `libtailscale_go.h` 是否落位、传给 node 的工作目录与参数（`hvigorw.js`、`buildMode=debug`、`debuggable=true`、`assembleHap`）、非 default 产品时的 stderr 文案
- 期望：正常：开发者从仓库根目录运行 `scripts/build.sh`。脚本应用必需的 tailscale 补丁。脚本调用 `go build -buildmode=c-shared` 产出 AArch64 动态库。脚本把 `.so` 与 `.h` 复制进 `entry/libs/arm64-v8a/`。脚本再用 hvigor wrapper 装配 Debug HAP。边界：补丁已应用时判定幂等并继续构建。工程目录含空格时引号处理仍成立。无关的本地脏文件不阻止补丁，也不被覆盖。失败与恢复：补丁冲突时在编译前中止，并保留源码原状。Release 或未知产品在任何构建或签名动作之前被拒。安全与质量：构建脚本对参数与路径的处理可被测试守住（R-BUILD-02）。
- 失败信息：期望「开发者从仓库根跑一次构建就得到可装配的 AArch64 产物」，实际「补丁被跳过、产物缺 .h、在错误目录装配，或 Release 静默产出未评审的包」
- 来源：scripts/build.sh:6-12 产品门；scripts/build.sh:13 cd 工程根；scripts/build.sh:53-59 hvigor wrapper 与显式 debug 参数；scripts/build-go.sh:54-66 apply_patch 幂等；scripts/build-go.sh:87-92 go build 与产物复制；scripts/test-macos-build.mjs（5 条用例）；docs/oracles/points/P5-build.md
- 上游：R-BUILD-01、R-BUILD-02
- 待建测试：[E2E] scripts/e2e/build-journey.mjs::开发者从仓库根运行构建脚本得到可装配的 AArch64 产物
- 状态：pending-test
- 不确定特征：none
- 归属：owner=项目维护者 接收批次=a01-E2E
- 复核：待复核
