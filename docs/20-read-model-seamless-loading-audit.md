# Read Model 无缝加载深度复盘

> 本文是 2026-06-13 对 read model 延时和前端无缝切换隐患的专项复盘。目标不是解释单点慢，而是把所有会让“系统加载好后切换仍卡顿、清空、错显、误报”的路径找出来，并转成后续可验收的修复清单。

## 结论

当前修复已经把 `/api/dashboard-session` 默认首屏读法降成 shell-only，磁盘 `dashboard-session/core.json` 也不再内嵌 profile/project/team 大块。2026-06-13 追踪修复又补上了 `read-model/current` 缺失重发布、teams 同页 scope guard、sync preparing 提示，以及默认年份窗口过滤。但系统仍存在复发级隐患：

- 后端 warmup/readiness 已能在完整 precompute 命中但 `read-model/current` 缺失时重发布；但 readiness 仍以完整 precompute 矩阵为核心判断，feature 级 ready 尚未拆开。
- `team-work-completion-detail` 仍默认生成 `owner * context * year` 全矩阵，第一轮实盘为 120 个文件、约 64.6 MB；异常年份 `2000` 已通过 schema 11 默认窗口排除，下一次重建会写入 `excludedYears`。
- 单个 project detail 或 team detail miss 仍会触发全局 precompute，而不是按 key 修复。
- teams 同页 URL scope 变化已接入局部 loader 和旧响应 guard；project catalog 已改为清 freshness 不清 visible rows，并捕获请求签名；details complex filter generation guard 仍未完全治理。
- 前端 sync 已避免在 read model preparing 时显示“已同步”；后端 sync/warmup 状态机仍未完整区分 ready/pending/failed features。
- read model 命中仍要经历 JSON parse、object merge、`JSON.stringify`、gzip，尚未进入 `.json.gz` 静态流式发送。
- 测试防线新增了 current 重发布、teams scope 一致、sync preparing、异常年份排除；但仍缺少 payload budget、矩阵文件数预算、单 key repair、预压缩发送、完整 sync 状态机等硬门槛。

因此，当前真实状态是：首屏读取路径和 teams 切换已进一步止血，但“加载完成后所有内容无缝切换”的目标尚未达成。

## 调研方法

本轮使用四个并行只读 agent 加本地主线复核：

| Agent | 范围 | 重点问题 |
| --- | --- | --- |
| Mill | 后端 read model / precompute | warmup、完整性判断、矩阵膨胀、miss 是否触发全局重建 |
| Tesla | 前端无缝切换 | 同页 hash、owner/context/year、旧响应回写、loading 清空、请求 fanout |
| Harvey | API / sync / 压缩 | stringify/gzip 成本、sync/warmup 语义、429 metadata、HEAD 成本 |
| Nietzsche | 测试与治理 | 现有测试覆盖、缺失预算、防复发规则和文档缺口 |

本地同时核对了当前工作树、CodeGraph 路径、实盘 `data/read-model/current` 文件规模和全量测试结果。

## 实盘证据

当前 `data/read-model/current` 规模：

| 目录 | 文件数 | 体积 |
| --- | ---: | ---: |
| `team-work-completion-detail` | 120 | 66130.4 KB |
| `team-metrics` | 3 | 11361.7 KB |
| `project-detail` | 555 | 3475.2 KB |
| `team-work-completion-summary` | 120 | 2519.2 KB |
| `team-responsibility-review` | 30 | 1607.8 KB |
| `profile-dashboard` | 3 | 1332.1 KB |
| `project-catalog` | 1 | 1005.6 KB |
| `dashboard-session` | 1 | 737.4 KB |

第一轮复盘时 manifest 包含：

```json
{
  "schemaVersion": 10,
  "features": [
    "dashboard-session",
    "project-catalog-summary",
    "profile-dashboard",
    "team-responsibility-review",
    "team-work-completion",
    "team-work-completion-summary",
    "team-work-completion-detail",
    "team-metrics",
    "project-detail"
  ],
  "owners": 10,
  "contexts": ["all", "franchise", "direct"],
  "years": [2000, 2024, 2025, 2026]
}
```

这说明异常年份 `2000` 和全 detail 矩阵当时仍在实盘放大 read model。当前代码已将 read model / precompute schema bump 到 11，并在默认自动发现年份时只保留当前年前两年到后一年窗口；`2000`、`2094` 这类异常年份会写入 `excludedYears`，显式 `options.years` 不受影响。

第一轮全量自动化结果：

```text
npm.cmd test
tests 694
pass 694
fail 0
duration_ms 8564.3134
```

测试全绿只能证明当前行为被覆盖，不能证明目标状态已完成，因为部分测试仍在锁定旧的完整矩阵行为。

2026-06-13 追踪验证：

```text
npm.cmd test -- tests/precomputeTeamDashboards.test.mjs
tests 20
pass 20
fail 0

npm.cmd test -- tests/precomputeTeamDashboards.test.mjs tests/readModelRepository.test.mjs tests/projectCatalog.test.mjs tests/frontendLoadPerformancePolicy.test.mjs tests/frontendSplitPolicy.test.mjs tests/rulesDocs.test.mjs
tests 91
pass 91
fail 0

npm.cmd test
tests 716
pass 712
fail 4
```

全量失败项集中在既有硬装 Deadline / 项目状态 / 完成语义改动：

- `company lifecycle completion does not use derived meeting cycle as trusted completion date`
- `readSnapshotFromDatabase uses exact terminal status matching for delay state`
- `isTerminalProjectStatus uses exact lifecycle status matching`
- `/api/team-work-completion returns the clean work completion payload without breaking legacy review`

它们不属于 read model 延时链路，但会阻止当前工作树全量绿灯。

## 风险矩阵

| 优先级 | 风险 | 证据 | 影响 | 当前测试状态 |
| --- | --- | --- | --- | --- |
| P0 | warmup 可在 `read-model/current` 缺失/损坏时误报成功 | `precomputeTeamDashboards()` 命中 `hasCompletePrecompute()` 后提前返回；publish read model 在后段执行 | 用户以为已 ready，实际 API 仍 preparing 或 miss | 已补“precompute 完整但 read-model/current 缺失时重发布”测试；仍需后端 warmup status 细化 |
| P0 | 同页 `#teams?...` scope 变化可能 URL 和内容不一致 | `showPage` 只在 pageChanged 时加载；hashchange 只同步 shell；teams 的 owner/context/year 不在 `applyHashSearch` 里处理 | 最坏情况是用户看着新 URL 操作旧负责人数据 | 已补内容 scope 对齐和迟到 session 不回写测试 |
| P1 | 完整性判断 all-or-nothing | `COMPLETE_PRECOMPUTE_FEATURES` 包含 project detail 和 team detail；`precomputeFilesComplete()` 要求全文件矩阵 | 一个局部 detail 缺失引发全局 incomplete 和重建 | 现有测试显式验证旧行为 |
| P1 | 默认 precompute 仍生成完整矩阵 | `contexts = all/franchise/direct`，`years = yearsFromProjects + currentYear`，owners 来自角色/团队/项目 | 成本随 `owners * contexts * years * projects` 放大 | 已补异常年份窗口和 `excludedYears` 测试；仍缺矩阵文件数和体积预算 |
| P1 | miss 触发全局 precompute | project detail、catalog、team detail miss 都调用 `triggerDashboardPrecompute...` | 单 key 缺失会启动整套 snapshot rebuild | 只测试 202 preparing，不测试 scoped repair |
| P1 | sync 成功/失败语义不可信 | sync 写入 snapshot 后等待 warmup；warmup 失败会让用户看到 sync failed；前端忽略 `loadDashboard()` 返回值 | 用户无法区分“源数据已同步”和“读模型生成中” | 已补前端 sync preparing 不显示已同步测试；后端 warmup 状态机仍缺 |
| P1 | 项目目录两阶段切换缺失 | `invalidateProjectCaches({ catalog: true })` 立即清空 `state.allProjects` | 同步/自动更新时可见项目列表出现空窗 | 已补清 freshness 不清 visible rows、旧请求签名和 stale catalog 下钻 fallback 测试；complex details filter 仍待 generation guard |
| P1 | read model 命中仍有响应层成本 | `sendJson()` 每次 stringify/gzip；reader 同步 parse json | 预计算省掉业务计算，但大 payload 仍有主线程响应成本 | 只检查 `gzipAsync`，无 `.json.gz` 静态发送测试 |
| P1 | preparing fallback 可能请求 fanout | dashboard-session retries 后 teams fallback 到 metrics、completion、review、catalog preload | read model 未 ready 时前端同时打多条重接口 | 缺少 repeated preparing 请求 ceiling |
| P2 | HEAD 请求仍构造 body | API 允许 HEAD，但 `sendJson()` 仍 stringify/gzip | 健康探测不轻量 | 无测试 |
| P2 | feature/schema 契约分散且 reader 默认要求过宽 | precompute 和 read model 各自维护 feature/schema；部分 reader 默认 `REQUIRED_READ_MODEL_FEATURES` | 新 feature 可能拖垮无关 reader | 缺少共享 contract drift 测试 |
| P2 | completion loading 会清空模块 shell | 冷 owner/preparing 路径可置 `teamWorkCompletion = null` 并渲染 loading | 无缓存目标时布局会跳，破坏无缝感 | 有保留旧内容测试，但缺少 panel collapse 断言 |

## 已经做对的方向

- `/api/dashboard-session` 无 owner 默认 shell-only，降低首屏响应体积。
- `dashboard-session/core.json` 不再内嵌 `profileDashboards` 和 `projectCatalog`。
- team detail 缺失时不会默认返回 last-known-good detail，避免当前 snapshot 被旧详情污染。
- teams scope switch 已有 requestId/shouldApply 防旧响应回写。
- 同页 hash/query 不触发页面级 reload 的原则已有测试和 AGENTS 规则。
- drill down 使用 `fields=ids` + 本地 catalog 拼装，避免回退全量 projects。
- gzip 已从同步 `gzipSync` 改成异步 `gzipAsync`。

这些方向必须保留，不要为了“快显示”回退成旧的大包或旧 detail 覆盖当前 snapshot。

## 根因分层

### 1. Read Model 层

根因是 read model 还没有 feature 级 ready contract。系统现在有 sidecar 文件，但 `complete` 概念仍然接近“所有 sidecar 全部存在”，导致 shell、summary、detail、interaction 之间没有可靠隔离。

必须拆成：

- Core shell ready：`dashboard-session/core.json`、snapshot、filters、department metrics 基础字段。
- Catalog summary ready：项目目录 summary 字段，不含 rawFields。
- Team summary ready：owner/context/year 的 summary 可扫读。
- Team detail ready：owner/context/year 的 detail 可交互。
- Project detail ready：单 project 的 full detail。
- Static transport ready：可直接发送 `.json.gz`，无需重复 stringify/gzip。

### 2. Precompute 层

当前 precompute 是一次性生成完整世界：

```text
projects + projectDetail(all)
+ contexts(all/franchise/direct)
  * owners(all)
  * years(project years + current)
  * team summary/detail
```

目标应改为分层：

- blocking：shell、catalog summary、profile summary、team metrics directory。
- page：当前 owner/context/year 的 summary/detail。
- interaction：点击到的 project detail、team detail。
- idle：历史年份、少用 owner/context 的补齐。

### 3. API 层

当前 API 命中 read model 仍以 object API 为主，不是真正静态命中。大 payload 应尽量走：

```text
Accept-Encoding: gzip -> stream *.json.gz
else -> stream *.json
```

同时 preparing 响应必须返回：

```json
{
  "status": "preparing",
  "reason": "...",
  "reasonCode": "...",
  "warmupStatus": {
    "state": "preparing",
    "readyFeatures": [],
    "pendingFeatures": [],
    "failedFeatures": []
  },
  "retryAfterMs": 1000
}
```

### 4. Frontend 层

无缝切换不是“永远不 loading”，而是：

- URL scope、可见标题、可见数据的 scope 不得互相矛盾。
- 有旧内容时保留旧内容，但必须标记正在切换到目标 scope。
- 无安全缓存时显示稳定 shell/局部 skeleton，不清空整个模块。
- 所有异步响应必须带 requestId 或 route tuple guard。
- catalog 和 detail cache 必须 two-phase swap，替换 ready 后再清旧数据。

### 5. 测试与治理层

现有测试缺口需要变成硬门槛：

- endpoint payload budget。
- no full matrix by default。
- scoped repair only。
- sync/warmup status machine。
- stale response never overwrites current route tuple。
- complex filter softRefresh generation guard。
- precompressed gzip static serving。
- read model contract drift detection。

## 修复路线

### Phase A: 先锁 P0 防线

1. `ensureDashboardPrecompute()` 必须验证 `read-model/current` 可读且契约满足 shell，若 precompute 完整但 read model 缺失，应从现有 precompute 目录 republish。
2. `/api/dashboard-warmup` 返回 `readyFeatures/pendingFeatures/failedFeatures`，不能只看 manifest features。
3. teams 同页 hash owner/context/year 变化必须触发 cache-first scope loader 或目标 loading state，且所有 session apply 带 route tuple guard。
4. `syncDingTalk()` 必须检查 `loadDashboard()` 返回值；未 ready 时显示“数据已同步，读模型生成中”而不是“已同步”。

### Phase B: 缩矩阵和 scoped repair

1. `hasCompletePrecompute()` 拆成 `hasCorePrecompute()`、`hasTeamBundlePrecompute(params)`、`hasProjectDetailPrecompute(projectId)`。
2. 默认 precompute 不再生成全量 `team-work-completion-detail` 矩阵，只生成当前 key 或配置指定 key。
3. 异常年份不再默认进入矩阵，`2000` 这类年份写入 `yearWarnings/excludedYears`。
4. missing detail 不再调用全局 `ensureDashboardPrecompute()`，改为 single-key job。

### Phase C: 响应层降成本

1. precompute 写 `.json` 时同步写 `.json.gz`。
2. read model 静态命中优先 stream 文件。
3. HEAD 请求不构造大 body。
4. API performance log 增加 `servedPrecompressed`、`fileReadMs`、`jsonStringifyMs`、`gzipMs`。

### Phase D: 前端无缝切换治理

1. `fetchProjectCatalog()` 捕获 request signature，旧请求 resolve 后不得按新 signature 记为 fresh。
2. `invalidateProjectCaches({ catalog: true })` 已改为保留 visible catalog，旧请求按请求签名记账；后续还要补 replacement ready 后 atomic swap 的端到端状态展示。
3. `applyVisibleProjects()` / complex details query 加 generation 或 AbortController。
4. preparing fallback 做 in-flight 去重，限制重复 fallback fanout。
5. completion/metrics loading 改成稳定 shell，不清空已展开结构。

### Phase E: 防复发规则和预算

1. `tests/dashboardSessionBudget.test.mjs`：默认 session shell 不含 page bundles，且小于预算。
2. `tests/precomputeTeamDashboards.test.mjs`：默认不生成 full detail matrix，missing detail 不影响 core ready。
3. `tests/publicAppBehavior.test.mjs`：同页 teams URL scope 变化后内容 scope 必须匹配或显示目标 loading；sync preparing 不得显示已同步。
4. `tests/serverReadModelGzip.test.mjs`：`.json.gz` 发送、`Content-Encoding`、路径安全、HEAD 轻量。
5. `tests/readModelRepository.test.mjs`：feature-level contract、reasonCode、warmupStatus、contract drift。
6. `AGENTS.md`：新增 read model 专项规则，避免后续功能把首屏和 detail 又绑回一起。

## 验收定义

本目标不能只用“测试通过”收尾，必须满足以下证据：

- 默认 `/api/dashboard-session` shell 在真实 endpoint 下不含 page bundles，并有体积预算测试。
- 当前页面已有内容时，owner/context/year/filter 切换不清空大面积内容，旧内容要么保留并明确标记目标切换，要么在安全缓存命中后原子替换。
- 同页 URL scope 变化不会出现 URL 与内容 scope 不一致。
- read model current 缺失或损坏时，warmup 能修复或明确失败，不会误报 ready。
- team detail/project detail miss 不会启动完整 snapshot precompute。
- 默认 read model 不再产生 full owner/context/year detail 矩阵。
- sync 状态能区分源数据写入、read model 生成中、read model ready、warmup failed。
- 大 read model 响应有预压缩静态发送路径，避免每次重复 stringify/gzip。
- `npm test` 全量通过，且新增预算/状态机/无缝切换测试确实覆盖上述目标。

## 当前建议的第一批实现

第一批不碰业务字段语义，只关掉最容易复发的系统风险：

1. 新增 read-model-current 校验/republish 测试和实现。
2. 新增 teams 同页 scope 变化行为测试和 route tuple guard。
3. 修 `syncDingTalk()` 返回值判断和提示文案。
4. 新增 dashboard session budget 测试。
5. 新增 precompute matrix budget 失败测试，为 Phase B 改实现铺路。

完成这一批后，再进入 scoped repair 和 `.json.gz` 静态发送。
