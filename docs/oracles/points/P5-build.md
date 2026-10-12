# MeshArc 单点判据 · macOS/Linux 构建与装配脚本（O-BUILD）

本文件覆盖 `scripts/test-macos-build.mjs` 的 5 条用例，守的是 `scripts/build-go.sh`（补丁应用、
引擎 c-shared 构建、产物复制）与 `scripts/build.sh`（产品门、hvigor 装配）。

**父判据说明**：本批 17 条接缝里没有「构建/装配」这一条——构建不是两个运行时模块之间的边。
按写作规范，这些判据暂挂 `O-SEAM-05`（应用进程 ↔ Go 引擎：生命周期面，即构建所产出的那份引擎），
并在 `不确定特征` 记 `UNCERTAIN-WIRING`，以便审核人要求时另立一条构建接缝。

**口径说明（本文件与 P3/P4 的关键差别）**：这些用例**不**使用 `vm` 沙箱。它们在临时目录里
真的建一个 git 仓库、真的 `git add`/`git diff` 生成补丁、真的 `spawnSync(bash, ...)` 跑仓库里
那份 `scripts/build.sh` / `scripts/build-go.sh` 原文。桩只有两个：`toolchain/bin/go` 与
DevEco 的 `node`（写成只把 argv 记到 `GO_BUILD_LOG` 的脚本）。所以**补丁应用、参数校验、路径与
引号处理、`set -euo pipefail` 的中止行为都是真实执行**；不被这条用例证明的是真的编译出了
AArch64 动态库、真的打出了 HAP。临时目录名故意带空格（`ohos build test `），以覆盖编译器和
源码路径的引号处理。

### O-BUILD-01 补丁应用幂等：全新与已打过补丁的 checkout 都能构建成功
- 层级：单点
- 父判据：O-SEAM-05
- 强度：强
- 设计依据：需求 R-BUILD-02「构建脚本对参数与路径的处理可被测试守住」；`scripts/build-go.sh:53-66`（先 reverse-check、再应用）
- 触发与前置条件：两个源码树（`toolchain`、`third_party/tailscale`）都在 git 下，补丁由各自的 diff 生成；同一份 `build-go.sh` 被连续执行两次（第二次源码树已处于打过补丁的状态）
- 可观测点：两次执行的退出码、`third_party/tailscale/source.txt` 的内容、stdout 里是「Applied patch」还是「Patch already applied」
- 期望：正常：第一次应用补丁并使源码变为补丁后的内容，第二次因 reverse-check 成功而判定「已经打过」并继续构建；边界：第二次不得因为「补丁已应用」而报错退出——幂等靠 `git apply --reverse --check` 而不是靠读工作区状态；失败与恢复：判定与应用都用 `--ignore-space-change --ignore-whitespace`，使行尾差异不把已应用的补丁误判为未应用
- 失败信息：期望「全新与已打补丁的 checkout 都能构建成功且补丁只生效一次」，实际「第二次执行报『补丁已应用』而中止，或把补丁又叠一遍使源码损坏」
- 来源：scripts/build-go.sh:10 set -euo pipefail；:54-66 apply_patch（:60 reverse-check 幂等判定、:63 应用）；:67-68 两棵源码树；scripts/test-macos-build.mjs:13-72 fixture（:33-46 用真 git 生成补丁，:44 patch 由 `git diff` 产出）
- 上游：R-BUILD-01、R-BUILD-02
- 测试：scripts/test-macos-build.mjs::fresh and already-patched checkouts build and copy both outputs
- 状态：closed
- 不确定特征：UNCERTAIN-WIRING
- 归属：—
- 复核：待复核

### O-BUILD-02 构建产物被复制进 HAP 的库目录
- 层级：单点
- 父判据：O-SEAM-05
- 强度：强
- 设计依据：需求 R-BUILD-01「产物必须是 AArch64 动态库且被正确打进 HAP」
- 触发与前置条件：`build-go.sh` 走完补丁与 `go build` 步骤
- 可观测点：`entry/libs/arm64-v8a/libtailscale_go.h`（用例以此取证）与同目录 `libtailscale_go.so` 是否存在且内容来自构建产物
- 期望：正常：构建产物从 `native/go_bridge/dist/arm64-v8a/` 复制到 `entry/libs/arm64-v8a/`，两者都要复制——HAP 从后者取库；边界：目标目录不存在时脚本先 `mkdir -p` 再复制；失败与恢复：`go build` 失败则本步不执行（`set -e`）且不留半份产物；安全与质量：命令与路径全部加引号，使带空格的工程根目录（macOS 的项目卷常见）不会推开参数
- 失败信息：期望「.so 与 .h 都落进 entry/libs/arm64-v8a/」，实际「只复制了 .so、头文件缺失使 HAP 里的 c-shared 库无法被装配引用，或路径含空格时复制到错误位置」
- 来源：scripts/build-go.sh:43-45 output_dir 与 hap_lib_dir（mkdir -p）；:87-89 go build -buildmode=c-shared 输出到 dist；:91-92 cp 到 hap_lib_dir；scripts/test-macos-build.mjs:80（断言 .h 内容为构建产物）
- 上游：R-BUILD-01
- 测试：scripts/test-macos-build.mjs::fresh and already-patched checkouts build and copy both outputs
- 状态：closed
- 不确定特征：UNCERTAIN-WIRING
- 归属：—
- 复核：待复核

### O-BUILD-03 引擎版本戳经 ldflags 注入且与依赖声明一致
- 层级：单点
- 父判据：O-SEAM-05
- 强度：弱
- 设计依据：需求 R-BUILD-01；`scripts/build-go.sh:87-89` 的 `-X tailscale.com/version.longStamp/-shortStamp` 与 `native/go_bridge/go.mod` 里的 `tailscale.com v1.86.5`
- 触发与前置条件：`build-go.sh` 调用 `go build`
- 可观测点：传给 `go` 的实参（用例把 argv 记进日志）：`longStamp=1.86.5` 与 `shortStamp=1.86.5` 是否同时出现
- 期望：正常：两个版本戳都由 `-ldflags -X` 注入且取自同一版本号，使引擎自报的版本与 go.mod 声明的依赖版本一致；边界：两个 stamp 必须都写，只写一个会让 `tailscale version` 一类输出半空；失败与恢复：升级 tailscale 依赖时这里必须同步——不一致会被这条断言挡下；安全与质量：`-trimpath` 使产物路径不含构建机目录
- 失败信息：期望「longStamp 与 shortStamp 都等于声明的 tailscale 版本」，实际「只注入一个 stamp，或版本号与 go.mod 不一致使引擎自报版本失真」
- 来源：scripts/build-go.sh:87-89（-buildmode=c-shared、-trimpath、-ldflags 里的两个 -X）；scripts/test-macos-build.mjs:47（fixture 的 go.mod 声明 v1.86.5）；scripts/test-macos-build.mjs:81（断言两个 stamp）
- 上游：R-BUILD-01
- 测试：scripts/test-macos-build.mjs::fresh and already-patched checkouts build and copy both outputs
- 状态：closed
- 不确定特征：UNCERTAIN-WIRING
- 归属：—
- 复核：待复核

### O-BUILD-04 无关的本地改动不阻止必需补丁，也不被覆盖
- 层级：单点
- 父判据：O-SEAM-05
- 强度：强
- 设计依据：需求 R-BUILD-02
- 触发与前置条件：`third_party/tailscale` 里有一个与补丁无关的文件被本地修改（如 `notes.txt`），补丁本身尚未应用
- 可观测点：脚本退出码、`source.txt` 是否变为补丁后的内容、`notes.txt` 是否仍保留本地改动
- 期望：正常：补丁判定只看补丁自身（reverse-check + apply），工作区里其它脏文件既不影响判定也不被改动——构建不得用 `git stash`/`git checkout` 清场；边界：本地改动落在补丁触及的文件上时属于冲突，由 O-BUILD-05 守；失败与恢复：不因为「仓库是脏的」就跳过补丁——跳过会让构建出的引擎缺少集成改动却仍然成功
- 失败信息：期望「无关脏文件不影响补丁应用且自身不被覆盖」，实际「看到 dirty 就跳过补丁，或用清场命令丢弃了开发者的本地改动」
- 来源：scripts/build-go.sh:54-66 apply_patch（不读工作区整体状态）；:60-63 --reverse --check 与 apply 都带 --ignore-space-change --ignore-whitespace；scripts/test-macos-build.mjs:85-92
- 上游：R-BUILD-02
- 测试：scripts/test-macos-build.mjs::unrelated dirty files do not suppress the required Tailscale patch
- 状态：closed
- 不确定特征：UNCERTAIN-WIRING
- 归属：—
- 复核：待复核

### O-BUILD-05 补丁冲突在编译前失败并保留源码原状
- 层级：单点
- 父判据：O-SEAM-05
- 强度：强
- 设计依据：需求 R-BUILD-02；`scripts/build-go.sh:10` 的 `set -euo pipefail`（失败即中止，不吞错）
- 触发与前置条件：补丁触及的文件已被改成与上下文冲突的内容（`source.txt` 为 `conflict`），补丁既不能应用也不能被 reverse-check
- 可观测点：脚本退出码（非 0）、`go` 是否被调用过（用例以 `go-args.txt` 是否存在取证）、`source.txt` 的内容是否仍是冲突时的原文
- 期望：正常：`git apply` 失败即非零退出，且在**编译步骤之前**——不得带着未打补丁的源码继续构建，也不得进入签名/打包；边界：失败只中止，不做自动回滚之外的任何破坏；失败与恢复：源码保持冲突时的原状，由人来解冲突——脚本不尝试强行应用或覆盖
- 失败信息：期望「冲突补丁使构建在编译前失败且源码未被改动」，实际「编译照常进行（产出缺集成改动的库）或源码被半途写坏」
- 来源：scripts/build-go.sh:10 set -euo pipefail；:56-59 缺补丁文件即退出；:60-63 reverse-check 失败后直接 apply 并让失败中止脚本；:86-89 编译在补丁之后；scripts/test-macos-build.mjs:94-101
- 上游：R-BUILD-02
- 测试：scripts/test-macos-build.mjs::conflicting patch stops before compiling and preserves the source
- 状态：closed
- 不确定特征：UNCERTAIN-WIRING
- 归属：—
- 复核：待复核

### O-BUILD-06 Release 与未知产品在构建或签名前被拒绝
- 层级：单点
- 父判据：O-SEAM-05
- 强度：强
- 设计依据：需求 R-BUILD-02；`scripts/build.sh:8-12`（macOS 入口只支持 default Debug 产品，Release 走 Windows 的 `build.ps1`）
- 触发与前置条件：以非 default 的产品名调用 `build.sh`——用例覆盖 `release` 与 `unknown`（含多于一个参数时同样走这条门）
- 可观测点：退出码（非 0）、stderr 的文案是否包含 `scripts/build.ps1 -Product release`、`go` 是否被调用过
- 期望：正常：非 default 产品在脚本开头即被拒，且**在任何构建动作之前**——`build-go.sh` 不被调用，也不存在签名/打包步骤；边界：参数个数大于 1 与产品名不为 default 走同一条门，`unknown` 这类拼写错误同样被挡；失败与恢复：错误文案要指出 Release 的正确入口（Windows 的 `build.ps1 -Product release`），使误用者知道去哪
- 失败信息：期望「Release/未知产品在构建与签名前被拒」，实际「未知产品名被当成 Debug 照常构建，或 Release 在 macOS 入口静默产出未评审的包」
- 来源：scripts/build.sh:6-12 产品门与 stderr 文案；:51 调用 build-go.sh（在产品门之后）；scripts/test-macos-build.mjs:103-111
- 上游：R-BUILD-02
- 测试：scripts/test-macos-build.mjs::Release and unknown products are rejected before any build or signing
- 状态：closed
- 不确定特征：UNCERTAIN-WIRING
- 归属：—
- 复核：待复核

### O-BUILD-07 Debug 装配用项目目录与 hvigor wrapper，并传显式 debug 参数
- 层级：单点
- 父判据：O-SEAM-05
- 强度：强
- 设计依据：需求 R-BUILD-02；`scripts/build.sh:53-59`（有 wrapper 就用 wrapper，调用前清 NODE_PATH）
- 触发与前置条件：default 产品、`build-profile.json5` 存在、DevEco 下同时有 `hvigor/bin/hvigorw.js` 与两个 hvigor 包的 package.json；从**工程目录之外**的目录调用 `build.sh`
- 可观测点：传给 node 的工作目录（`$PWD`）、参数里是否有 `hvigorw.js`/`buildMode=debug`/`debuggable=true`/`assembleHap`、调用时 `NODE_PATH` 是否为空
- 期望：正常：脚本先 `cd "$ROOT"` 使 `$PWD` 是工程根（末尾是工程目录名），装配用 wrapper（`hvigorw.js`）而不是 `hvigor.js`，并显式传 `-p buildMode=debug -p debuggable=true`；边界：wrapper 不存在时回退到 `hvigor.js`（该分支无用例）；失败与恢复：调用 wrapper 之前 `unset NODE_PATH`，避免父 shell 继承的 NODE_PATH 改变 wrapper 的模块解析；安全与质量：`-p product="$Product"` 与前面的产品门一致，不得在装配参数里出现被门拒绝的产品名
- 失败信息：期望「项目目录 + wrapper + 显式 debug 参数 + 空 NODE_PATH」，实际「在调用者的目录里装配、用 hvigor.js 绕过工程解析，或忘记传 debuggable 使产物不是 Debug」
- 来源：scripts/build.sh:13 cd "$ROOT"；:28-30 与 :36 hvigor/wrapper 路径与存在性检查；:53-57 有 wrapper 时 unset NODE_PATH 并改用 wrapper；:58-59 node "$hvigor" 与 assembleHap 参数；scripts/test-macos-build.mjs:113-131
- 上游：R-BUILD-02
- 测试：scripts/test-macos-build.mjs::Debug uses the project directory, wrapper, and explicit debug flags
- 状态：closed
- 不确定特征：UNCERTAIN-WIRING
- 归属：—
- 复核：待复核
