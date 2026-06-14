# SaaS 系统读取性能与 Read Model 优化方案

## 1. 背景与结论

这份文档记录一次针对 Yeswood Dashboard / SaaS 看板系统读取慢、链路复杂、反复修复不稳定的问题复盘。

核心结论：

- 当前系统不是“必须这么复杂”，而是复杂度放错了位置。
- Read Model、API、前端 loader 原本是为了让大看板更快，但现在形成了“首屏一次拿太多 + read model 命中后仍可能回源重算 + 前端等待巨型 bundle”的组合问题。
- 不建议简单删除 Read Model；更合理的方向是把 Read Model 降级为 feature-scoped 加速层，而不是首屏万能数据库。
- `/api/dashboard-session` 应退回 shell-first：只负责页面外壳、snapshot、轻量指标和 feature readiness；团队、负责人、详情等数据改由独立模块接口加载。
- 第一阶段不应直接做大规模数据库迁移，而应先修掉 P0 热路径：禁止 read model 命中后同步 `getSnapshot`，并让团队页首屏不再等待 owner 级 dashboard-session。

## 2. 当前主要问题

### P0：Read Model 命中后仍可能走重型 snapshot 回源

证据位置：

- `src/backend/server.mjs`
- `/api/dashboard-session` 路由
- 关键位置：`server.mjs` 中 owner dashboard-session 的 read model payload shape 检查逻辑

当前问题：

- 请求日志可能显示 `readModelHit: true`。
- 但如果 payload 中缺少 `team.metrics.team.groups` 等路由层要求的 shape，服务端仍会同步调用 `getSnapshot(config)` 和 `resolveTeamMetricsBatch`。
- 这会导致 read model 命中仍然慢到数秒甚至十几秒。

影响：

- 用户看到的是“明明做了 read model，还是慢”。
- 修复方向容易被误判成“继续加缓存”，但真正问题是命中路径里混入了重型回源。

原则：

- Read model 命中路径不能同步回源重算。
- Shape 不匹配应在 read model repository 层被识别为 miss / stale / schema mismatch。
- 请求中不能把局部缺片升级成全量 snapshot 重算。

### P0：团队页首屏被 owner 级 dashboard-session 卡住

证据位置：

- `public/pages/teams.mjs`
- `loadTeamDashboardScope`
- `loadTeamDashboardSessionBundle`

当前问题：

- 团队页切换负责人/上下文时，会先请求 owner 级 `/api/dashboard-session`。
- 这个接口 payload 大、组合复杂、任何一块慢都会阻塞首屏。
- 更快的模块 fallback 逻辑是在 owner dashboard-session 返回或失败后才开始。

影响：

- 前端首屏主动选择了最重路径。
- 即使后端某些模块接口本身很快，用户仍会被 dashboard-session 卡住。

原则：

- 团队页首屏应 module-first。
- 先并行拉：
  - `/api/team-metrics?owner=...`
  - `/api/team-work-completion?view=summary`
  - `/api/team-responsibility-review?owner=...`
- detail / full project / drilldown 在用户需要时再懒加载。

### P1：`/api/dashboard-session` 变成万能大包

证据位置：

- `src/backend/readModelRepository.mjs`
- `public/lib/dashboard-loader.mjs`

当前问题：

- 一个 dashboard-session 可能组合 shell、profile dashboards、project catalog、team metrics、team work completion detail、responsibility review 等多类数据。
- 前端 `applyDashboardSessionPayload` 又会一次性写入大量全局 state。

影响：

- 数据边界不清。
- 缓存边界不清。
- 任何一个模块变慢，会拖慢整个页面。
- 页面切换、owner 切换、hash 变化容易触发大范围状态污染或旧响应覆盖。

原则：

- `dashboard-session` 只保留 shell-first。
- profile、team、catalog、detail 应该由各自 domain loader 独立加载、独立缓存、独立失效。

### P1：Read Model 文件粒度太粗

当前问题：

- `team-metrics/{context}.json` 是 context 级大文件，读取一个负责人也需要解析整个 context。
- `team-work-completion-detail` 会生成大量 owner/context/year 明细文件。
- `project-detail` 也会生成大量项目详情文件。

影响：

- 对当前几百个项目的数据规模来说，文件 read model 反而像第二套数据库。
- 预计算、发布、repair、读取、gzip 都变复杂。

原则：

- SQLite 保留 canonical 数据。
- Read Model 只保留必要的 feature-scoped 加速产物。
- owner/context/year 明细按需生成或 scoped repair，不默认铺满完整矩阵。

### P1：大 payload 的压缩主路径没有接上

证据位置：

- `src/backend/server.mjs`
- `DYNAMIC_GZIP_MAX_BYTES`
- `sendPrecompressedJson`

当前问题：

- 动态 gzip 只处理小 payload。
- 大 payload 如果没有走 `.json.gz` 直出，会以大 JSON 返回。
- 代码里存在 precompressed 发送函数，但核心路径没有充分接上。

影响：

- owner 级 dashboard-session 可能达到数 MB。
- 即使服务端计算不慢，传输和 JSON parse/stringify 也会慢。

原则：

- 大型静态 sidecar 应优先 `.json.gz` 预压缩直出。
- 动态 parse -> stringify -> gzip 只能作为兜底，不能成为大文件主路径。

### P2：测试在保护旧复杂链路

证据位置：

- `tests/teamMetrics.test.mjs`
- `tests/readModelRepository.test.mjs`
- `tests/precomputeTeamDashboards.test.mjs`
- `tests/publicAppBehavior.test.mjs`
- `tests/serverReadModelGzip.test.mjs`

当前问题：

- 一些测试仍然断言 dashboard-session 应包含完整 team/profile/catalog 数据。
- 这会把系统拉回“万能 dashboard-session”旧契约。

原则：

- 测试应保护新边界：
  - shell session 体积预算
  - 团队页不依赖 owner bundle 首屏
  - read model hit 不回源
  - summary/detail 分离
  - 局部 repair 不触发全量 precompute

## 3. 目标架构

```text
页面进入
  -> /api/dashboard-session
       只返回 shell + snapshot + 轻量指标 + feature readiness

团队页首屏
  -> 并行请求：
       /api/team-metrics?owner=...
       /api/team-work-completion?owner=...&context=...&year=...&view=summary
       /api/team-responsibility-review?owner=...&context=...&year=...

详情 / 下钻 / 弹窗
  -> 按需请求：
       /api/team-work-completion?view=detail
       /api/projects?id=...&view=full
       /api/projects?fields=ids

Read Model
  -> feature-scoped 加速层
  -> 可以命中则快速返回
  -> 缺片则返回 preparing / repairQueued
  -> scoped repair 单 key 修复
  -> 不在用户请求中同步全量重算
```

## 4. 分阶段实施方案

### Phase 0：先止血，修掉 P0 热路径

目标：

- 禁止 read model 命中后同步 `getSnapshot`。
- 建立基本 payload / latency / hit-path 防回归测试。

实施点：

- 把 `team.metrics.team.groups` 等 shape 校验移动到 `readDashboardSessionReadModel` 或 repository 层。
- 如果 read model payload schema 不匹配，返回明确状态：
  - `readModelStatus: "schemaMismatch"`
  - `repairQueued: true`
  - 或 HTTP 202 preparing
- 请求路径不要现场调用重型 snapshot 兜底。
- 建立日志字段：
  - `readModelHit`
  - `readModelStatus`
  - `snapshotMs`
  - `servedPrecompressed`
  - `payloadBytes`
  - `repairQueuedKey`

验收标准：

- Read model 命中的 `/api/dashboard-session` 不再出现数秒级 `snapshotMs`。
- 局部缺片只触发 scoped repair，不触发全量 precompute。
- 测试覆盖 read model hit 不回源。

### Phase 1：团队页改成 module-first

目标：

- owner dashboard-session 退出团队页首屏关键路径。
- 团队页先显示 summary 和核心指标，再按需加载 detail。

实施点：

- 修改 `public/pages/teams.mjs`：
  - `loadTeamDashboardScope` 不再先 await `loadTeamDashboardSessionBundle`。
  - 首屏并行请求 `team-metrics`、`team-work-completion summary`、`team-responsibility-review`。
  - 旧 owner 请求通过 requestId / generation 防止晚返回污染当前 owner。
- `team-work-completion` 缓存拆成：
  - summary ready
  - detail ready
- detail 只在详情弹窗、下钻、导出等需要时加载。

验收标准：

- 切换负责人时，页面不等待 owner dashboard-session 大包。
- summary 有缓存时立即显示旧内容占位，并后台刷新。
- detail 未 ready 不阻塞首屏。

### Phase 2：拆掉万能 dashboard-session 契约

目标：

- `/api/dashboard-session` 默认 shell-first。
- owner/profile/team/catalog 各自走独立接口和独立 loader。

实施点：

- `/api/dashboard-session` 默认只返回：
  - shell
  - snapshot metadata
  - runtime flags
  - lightweight metrics
  - feature readiness map
- 如确需兼容旧路径，必须显式 include：
  - `include=profile`
  - `include=team`
  - `include=catalog`
- 前端拆分 `applyDashboardSessionPayload`：
  - `applyShellSessionPayload`
  - `applyProfilePayload`
  - `applyTeamPayload`
  - `applyCatalogPayload`
- 逐步删除 owner 级万能 bundle 的默认使用。

验收标准：

- 默认 `/api/dashboard-session` payload 小于预算。
- 页面普通进入不下载 team detail / full catalog / profile dashboards 大对象。
- feature readiness 能准确表达 preparing / ready / stale。

### Phase 3：重塑 Read Model 与数据层边界

目标：

- SQLite 作为 canonical 数据源。
- Read Model 只做按 feature 加速。
- 不再默认生成完整 owner * context * year 明细矩阵。

实施点：

- 保留 SQLite canonical 表：
  - projects
  - raw fields
  - sync runs
  - overrides
  - personnel
  - responsibility
- 同步时生成 derived facts：
  - project_facts
  - project_metric_events
  - team_scope_memberships
  - field_catalog
- Read Model 只生成：
  - 当前 shell/core
  - 当前常用 owner/context/year summary
  - 高频页面需要的 sidecar
- team metrics 改成 owner/context 细粒度或按需计算 + LRU 缓存。
- team completion detail 改为按需生成。
- project full detail 继续懒加载。

验收标准：

- 默认预计算不再铺满完整矩阵。
- scoped repair 只修单个 owner/context/year。
- full detail 不进入首屏。

### Phase 4：传输、压缩与观测

目标：

- 大 sidecar 走 `.json.gz` 静态直出。
- 慢在哪里能从日志直接看出来。

实施点：

- 接通 `sendPrecompressedJson` 到 read-model-backed 大 payload。
- 对大型 sidecar 生成 `.json` 与 `.json.gz`。
- 增加响应预算：
  - `dashboard-session` shell 默认小于 500KB
  - team completion summary 小于约定预算
  - detail 只在显式请求时允许大 payload
- 日志字段补齐：
  - endpoint
  - owner/context/year
  - readModelHit
  - readModelStatus
  - fileReadMs
  - stringifyMs
  - gzipMs
  - payloadBytes
  - servedPrecompressed
  - repairQueuedKey

验收标准：

- 大 payload 有明确 gzip 直出路径。
- 日志可区分：文件读取慢、JSON parse 慢、传输大、回源慢、repair 慢。

### Phase 5：测试、文档与防复发规则同步

目标：

- 测试保护新的轻量化架构，而不是旧的大包契约。

实施点：

- 更新或新增测试：
  - dashboard session shell budget test
  - read model hit no snapshot fallback test
  - teams module-first behavior test
  - completion summary/detail split test
  - scoped repair does not full precompute test
  - precompressed large sidecar test
- 同步项目规则文档和 AGENTS 防复发规则。
- 对旧测试中要求 dashboard-session 带完整 team/profile/catalog 的断言做迁移。

验收标准：

- 任何改动如果把 owner dashboard-session 放回首屏关键路径，测试失败。
- 任何 read model hit 后同步 `getSnapshot`，测试失败。
- 任何默认 dashboard-session payload 超预算，测试失败。

## 5. 第一轮建议实施任务

第一轮不要做大规模数据库迁移。

建议只做以下三件事：

1. 禁止 `/api/dashboard-session` readModel 命中后同步 `getSnapshot`。
2. 团队页改成 module-first，owner dashboard-session 退出首屏关键路径。
3. 加预算和防回归测试，把以上两个问题钉死。

预期收益：

- 能最快缓解当前“各种读取特别慢”的问题。
- 改动范围可控。
- 不会一次性重写后端数据层。
- 为后续 Read Model 降级和 API 拆分建立安全边界。

## 6. 最终验收清单

完成后应至少满足：

- `/api/dashboard-session` 默认 shell-first，不默认返回完整 team/profile/catalog/detail。
- 团队页首屏不依赖 owner 级 dashboard-session。
- Read model hit 后不会同步调用 `getSnapshot`。
- Owner/context/year 切换有 requestId / generation 防旧响应回写。
- Team completion summary 和 detail 明确拆分。
- Detail、project full detail、drilldown 数据按需加载。
- 大型 read model sidecar 支持 `.json.gz` 直出。
- 日志能解释慢请求具体慢在哪里。
- 预算测试、防回归测试覆盖核心加载边界。

## 7. 下次继续修复时的入口

优先查看和修改：

- `src/backend/server.mjs`
- `src/backend/readModelRepository.mjs`
- `src/backend/precomputeTeamDashboards.mjs`
- `public/pages/teams.mjs`
- `public/lib/dashboard-loader.mjs`
- `public/domain/team-work-completion-store.mjs`
- `tests/publicAppBehavior.test.mjs`
- `tests/frontendLoadPerformancePolicy.test.mjs`
- `tests/precomputeTeamDashboards.test.mjs`
- `tests/teamMetrics.test.mjs`
- `tests/teamWorkCompletionApi.test.mjs`

下次开工建议：

1. 先写或更新测试，锁住“read model hit 不回源”和“团队页不等 owner dashboard-session”。
2. 再改后端 `/api/dashboard-session` 的 P0 热路径。
3. 再改前端团队页加载顺序。
4. 最后运行相关测试，并用运行中服务验证普通接口，不只看 `forceRefresh=true`。
