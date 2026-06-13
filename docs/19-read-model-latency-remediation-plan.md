# Read Model 延时调研与修复方案

> 本文用于收束本轮 `read model` 强延时问题的代码复核、根因判断与分阶段修复方案。它不是实现提交说明，而是后续修复的总路线图。

## 1. 一句话结论

这次问题不是某个页面点击路径没有预热，而是系统处在一个“磁盘 read model 已开始拆分、API 与前端仍按全量 session 大包使用”的中间态。当前主要矛盾是：

- read model 只有全局 `schemaVersion + features`，缺少分 feature 的契约与兼容等级。
- `/api/dashboard-session` 默认把 shell、profile、project catalog、team metrics、team work completion detail、responsibility review 重新拼成一个会话大包。
- `ensureDashboardPrecompute()` 和 `hasCompletePrecompute()` 把完整矩阵作为 ready 条件，导致一个局部 detail 缺失也会拖垮首屏 session。
- 前端 `applyDashboardSessionPayload()` 把大包全量写入全局 state，`syncDingTalk()` 也没有检查 `loadDashboard()` 返回值，read model preparing 时仍可能显示“已同步”。
- 当前测试有加载边界和功能正确性保护，但缺少 session 体积、矩阵文件数、分 feature 契约、同步状态机和静态 gzip 的性能预算防线。

因此，修复方向应从“继续加预热”切换到“重定义 read model 边界”：轻量首屏 shell + 页面模块 bundle + 当前交互 key detail + 可恢复的版本契约。

## 2. 调研来源

本轮调研综合了四类证据：

1. 用户提供的 GPT/Codex review 结论。
2. 主线代码复核，重点查看 `readModelRepository.mjs`、`precomputeTeamDashboards.mjs`、`server.mjs`、`syncService.mjs`、`dashboard-loader.mjs`、`project-catalog.mjs`、启动脚本与现有测试。
3. 三个只读子代理复核：
   - 后端 read model / 预计算侧。
   - 前端加载 / 同步状态侧。
   - 测试 / 防复发策略侧。
4. 本地 `data/read-model/current` 实盘读模型量化。

两点需要校正原 review 表述：

- `dashboard-session/core.json` 本身已经不直接内嵌 `profileDashboards` 和 `projectCatalog`，但 `readDashboardSessionReadModel()` 在 API 读出时会读取 sidecar 文件并重新拼成大 payload。所以问题不是“core 文件仍是大包”，而是“API session 契约仍是大包”。
- 同页 hash/query 触发重载的风险已经被现有路由规则部分控制，当前更大的前端风险是 session 与各页面局部 loader 共享并竞争全局 state ownership。

### 2.1 二次 review 补充判断

执行前还需要补上四个判断，避免实现阶段走偏：

1. **先修状态表达，再拆数据大包。** Phase 1 不应急着重构所有 endpoint；先让用户看到准确的 incompatible/preparing/cooldown 状态，并修掉“已同步”误报。
2. **shell-only 是最终默认，但不是第一刀强切。** 当前 direct/franchise/teams 的部分测试和页面逻辑仍依赖 session 注入 bundle。第一轮应先加 `include=` 或 shell reader，并保留兼容路径，再逐页迁移。
3. **年份去噪不能静默丢业务数据。** `2000` 大概率是日期解析噪声，但实现时应记录 `excludedYears` 或 `yearWarnings`，不要直接吞掉异常年份。
4. **预压缩是后置收益，不是止血手段。** 如果 session 仍是大包，`.json.gz` 只会掩盖边界问题；必须先把默认 session 体积打下来。

## 3. 当前实盘证据

### 3.1 本地 read model 版本不一致

当前代码中：

- `src/backend/readModelRepository.mjs` 的 `READ_MODEL_SCHEMA_VERSION = 10`。
- `src/backend/precomputeTeamDashboards.mjs` 的 `PRECOMPUTE_SCHEMA_VERSION = 10`。

但本地磁盘：

```json
{
  "schemaVersion": 8,
  "readModel": true,
  "totalRecords": 554,
  "contexts": ["all", "franchise", "direct"],
  "years": [2000, 2024, 2025, 2026]
}
```

直接调用 reader 的结果：

```json
{
  "status": "incomplete",
  "reason": "project catalog summary workflow fields are missing"
}
```

进一步检查 `project-catalog/summary.json`，当前 554 条项目中 summary 已有 `stageReminder`，但缺少 `workflowFacts`。这说明旧 schema 不是在 manifest 层被明确判为 incompatible，而是进入 session reader 后才被字段校验打回。

### 3.2 本地 read model 文件体积分布

当前 `data/read-model/current` 文件分布：

| 目录 | 文件数 | 体积 |
| --- | ---: | ---: |
| `dashboard-session` | 1 | 737.3 KB |
| `profile-dashboard` | 3 | 1,836.2 KB |
| `project-catalog` | 1 | 1,510.2 KB |
| `project-detail` | 555 | 3,250.2 KB |
| `team-metrics` | 3 | 11,357.7 KB |
| `team-responsibility-review` | 30 | 1,602.1 KB |
| `team-work-completion-summary` | 120 | 2,521.3 KB |
| `team-work-completion-detail` | 120 | 62,668.4 KB |

这组数据说明：

- 10 个 owner × 3 个 context × 4 个 year 正好形成 120 个 completion detail 文件。
- `team-work-completion-detail` 单独约 61 MB，是最大膨胀源。
- `years` 中出现 `2000`，说明从项目日期字段扩散年份时已经把非业务年份纳入矩阵。
- 即使 `dashboard-session/core.json` 自身只有 737 KB，API 默认 session 读出时还会追加 catalog/profile/team sidecar，最终响应远大于 core。

## 4. 当前代码关键链路

### 4.1 后端 reader 与 session API

关键路径：

```text
/api/dashboard-session
  -> readDashboardSessionReadModel()
  -> buildReadModelResult()
  -> read dashboard-session/core.json
  -> read profile-dashboard/{department,direct,franchise}.json
  -> read project-catalog/summary.json
  -> read team-metrics/{context}.json
  -> read team-work-completion-summary/{owner,context,year}.json
  -> read team-work-completion-detail/{owner,context,year}.json
  -> read team-responsibility-review/{owner,context}.json
  -> merge and sendJson()
```

证据文件：

- `src/backend/server.mjs`：`/api/dashboard-session` 直接返回 `readModel.payload`。
- `src/backend/readModelRepository.mjs`：`buildReadModelResult()` 读 profile、catalog、team 四类 sidecar 并写入同一 payload。
- `src/backend/readModelRepository.mjs`：`MIN_DASHBOARD_SESSION_SCHEMA_VERSION = 5`，session reader 接受 5..10，但 catalog summary 字段按新契约强校验。

### 4.2 后端预计算 ready 条件

关键路径：

```text
ensureDashboardPrecompute()
  -> hasCompletePrecompute()
  -> precomputeFilesComplete()
  -> require all COMPLETE_PRECOMPUTE_FEATURES
  -> require all project detail files
  -> require all context team metrics
  -> require all owner × context responsibility review
  -> require all owner × context × year workCompletion summary/detail
```

证据文件：

- `src/backend/syncService.mjs`：`ensureDashboardPrecompute()` 只认 `hasCompletePrecompute()`。
- `src/backend/precomputeTeamDashboards.mjs`：`precomputeFilesComplete()` 检查完整矩阵。
- `src/backend/precomputeTeamDashboards.mjs`：默认 contexts 为 `all/franchise/direct`，years 来自项目日期 + 当前年，owners 来自人员架构和项目负责人。

### 4.3 响应发送成本

`src/backend/server.mjs` 的 `sendJson()` 当前每次：

```text
JSON.stringify(payload)
  -> payload > 1KB && Accept-Encoding includes gzip
  -> gzipAsync(body)
  -> response.end()
```

优点是已经避免 `gzipSync` 阻塞事件循环；不足是大 payload 每次请求仍重复同步 stringify，并重复 gzip。

### 4.4 前端 session apply 边界

关键路径：

```text
loadDashboard()
  -> loadDashboardSession()
  -> fetchJson('/api/dashboard-session?...')
  -> applyDashboardSessionPayload()
  -> write global state:
     snapshot, metrics, fullMetrics, profileMetrics, profileProjects,
     profileDashboardLoaded, allProjects, fieldCatalog, projects,
     filters, teamMetrics, teamWorkCompletion, ownerReview
```

证据文件：

- `public/lib/dashboard-loader.mjs`：`loadDashboardSession()` 非 preparing 时直接 apply。
- `public/lib/dashboard-loader.mjs`：`applyDashboardSessionPayload()` 同时写 shell/profile/catalog/team 全域状态。
- `public/pages/teams.mjs`：team 页面另有 `loadTeamDashboardSessionBundle()`，也使用 `/api/dashboard-session`。
- `public/pages/profile-shared.mjs` 与 `public/domain/project-catalog.mjs` 已有独立 loader，但 session 大包会提前写入它们的 state。

### 4.5 同步按钮误报

当前：

```javascript
const snapshot = await fetchJson(DASHBOARD_SYNC_ENDPOINT, ...);
invalidateProjectCaches(...);
await loadDashboard({ snapshot, forceRefresh: true });
setSyncMessage('已同步');
```

而 `loadDashboard()` 在 session 仍 preparing 时会 `return false`。所以同步完成但 read model 未 ready 时，前端仍可能显示“已同步”。

另一个细节：`fetchJson()` 把 HTTP 202 当作成功响应返回，因此 `{ status: 'preparing' }` 不会走 catch。

## 5. 根因排序

### P0 - read model ready 条件 all-or-nothing

当前系统把完整 precompute 作为 read model 可用前提，导致 project detail 或某个 owner/context/year detail 缺失，都可能让 `/api/dashboard-session` 退化为 preparing。首屏 shell 与深层 detail 没有分级。

### P0 - 本地磁盘 read model 与代码契约不一致

代码升级到 schema 10，磁盘 manifest 仍是 schema 8；reader 允许旧 session schema，但又要求新 catalog 字段。结果是错误发生在 reader 中段，用户只能看到 preparing/loading，无法知道是 schema/field contract mismatch。

### P1 - API session 重新组大包

预计算产物已经有 sidecar 拆分，但 API 默认读出时又把 profile/catalog/team detail 合并回 `/api/dashboard-session`。这让首屏响应体积、文件读取次数、JSON.stringify、gzip 和前端 state 写入一起变重。

### P1 - 前端 state ownership 过度集中

`applyDashboardSessionPayload()` 同时控制 profile、project catalog、team completion、owner review 多个模块。任一模块契约变化都会扩大成全局 session 风险。

### P1 - 预计算矩阵膨胀

默认生成 owner × context × year 的 team-work-completion detail。当前实盘 120 个 detail 文件约 61 MB。detail 是交互层数据，不应该作为首屏 blocking ready 条件。

### P2 - 同步和 warmup 状态表达不足

`syncGate` 只返回 `status/message`，没有 `retryAfterMs/cooldownUntil`。`dashboard-sync` 成功只返回 `warmed/features`，没有结构化 `warmupStatus`。前端只能显示“稍后再试/已同步/同步失败”，无法表达“源数据已同步，读模型仍在生成”。

### P2 - 详情 read model 缺失时局部 UX 不清楚

`fetchProjectDetail()` 默认使用 30 秒 timeout，也不识别 202 preparing payload。项目详情弹窗能先显示摘要，但 full detail 未 ready 时基本静默返回 null。

## 6. 目标架构

### 6.1 Read model 契约从全局版本改为分 feature 契约

manifest 保留全局 `schemaVersion`，但新增 feature 级契约：

```json
{
  "schemaVersion": 10,
  "featureVersions": {
    "dashboard-session": 3,
    "project-catalog-summary-base": 1,
    "project-catalog-interaction": 1,
    "project-detail": 2,
    "profile-dashboard": 2,
    "team-metrics": 2,
    "team-work-completion-summary": 3,
    "team-work-completion-detail": 3,
    "team-responsibility-review": 2
  },
  "featureStatus": {
    "dashboard-session": "ready",
    "project-catalog-summary-base": "ready",
    "project-catalog-interaction": "ready",
    "team-work-completion-detail": "partial"
  },
  "fieldContracts": {
    "project-catalog-summary-base": [
      "id",
      "name",
      "province",
      "businessType",
      "storeStatus",
      "status",
      "owner",
      "franchiseScope",
      "hardProgressStage",
      "softProgressStage"
    ],
    "project-catalog-interaction": [
      "stageReminder",
      "workflowFacts",
      "stageReminder.dataGapCount",
      "workflowFacts.lifecycleClosed"
    ]
  }
}
```

Reader 结果统一分为：

| 状态 | 含义 | API 行为 |
| --- | --- | --- |
| `ready` | 当前 feature 与代码契约完全匹配 | 返回 200 |
| `stale-compatible` | 对 shell/core 可兼容读取，但缺少非阻塞 feature | 返回 200，payload 标记 `compatRepaired/staleCompatible` |
| `incompatible` | 影响当前 endpoint 的硬契约不满足 | 返回 202 或 503，触发对应 feature warmup |
| `preparing` | 任务已排队或正在生成 | 返回 202，带 `warmupStatus` |
| `failed` | 生成失败 | 返回 503，带错误摘要和日志指引 |

核心原则：

- shell/core 可以有更宽的兼容范围。
- team detail 不允许用 stale last-known-good 覆盖当前状态。
- project catalog 的交互字段缺失不能拖垮首屏 shell。
- schema/字段不匹配应在 manifest/contract 层明确报出，不应读到一半才变成 generic preparing。

### 6.2 `/api/dashboard-session` 默认变成 shell-only

默认返回：

```json
{
  "schemaVersion": 10,
  "readModel": true,
  "snapshotHash": "...",
  "snapshot": {
    "source": "dingtalk",
    "syncedAt": "...",
    "totalRecords": 554,
    "fieldCount": 52,
    "dashboardSyncEnabled": true,
    "dashboardAutoUpdateEnabled": true,
    "developerDocumentationVisible": true,
    "dashboardDisplayMode": "development",
    "personnelArchitecture": {}
  },
  "filters": {},
  "metrics": {},
  "departmentMetrics": {},
  "ready": {
    "projectCatalogSummary": true,
    "profileDashboard": {
      "department": true,
      "direct": false,
      "franchise": false
    },
    "teamBundle": false
  },
  "warmupStatus": {
    "state": "ready",
    "readyFeatures": ["dashboard-session"],
    "pendingFeatures": []
  }
}
```

默认不返回：

- `profileDashboards`
- `projectCatalog.items`
- `team.metrics`
- `team.workCompletion`
- `team.responsibilityReview`
- `team.workCompletion.projectsById`

过渡期可以保留 `include=`：

```text
/api/dashboard-session?include=shell
/api/dashboard-session?include=shell,projectCatalog
/api/dashboard-session?include=shell,profile:direct
/api/dashboard-session?include=shell,team&owner=...&context=...&year=...
```

最终更推荐独立 endpoint：

| 页面 | 默认加载 |
| --- | --- |
| overview | shell + overview 必需 metrics + 可见 drill ids |
| details | shell + `/api/projects?view=summary` |
| direct/franchise | shell + `/api/dashboard-metrics?profile=direct|franchise` + `/api/projects?profile=...&view=summary` |
| teams | shell + `/api/team-session?owner&context&year` 或现有三接口 |
| owner-review | shell + `/api/team-responsibility-review?owner&context` |
| project detail | `/api/projects?id=...&view=full&fallback=readModel` |

### 6.3 预计算分层

把预计算从全量矩阵改成分层模型：

| 层级 | 优先级 | 内容 | 是否阻塞打开页面 |
| --- | --- | --- | --- |
| Layer 1: Core | `blocking` | session shell、filters、department metrics、project-catalog-summary-base、profile metrics summary、人员/团队目录 | 是 |
| Layer 2: Page | `page` | 当前页面高概率需要的数据，如默认 owner/context/year 的 team summary/detail、profile 页面 summary | 否 |
| Layer 3: Interaction | `interaction` | 当前点击 key 的 project detail、team detail、drill ids | 否 |
| Layer 4: Idle | `idle` | 低优先级补齐，历史年份或少用 owner/context | 否 |

team-work-completion-detail 默认不再生成全量 owner × context × year。最多生成当前 key：

```text
currentOwner × currentContext × currentYear
```

其他 key 请求时：

1. 快速返回 202。
2. 只排队该 key 的 detail job。
3. 不触发完整 precompute。
4. 前端保留旧内容或摘要，并显示“读模型生成中”。

### 6.4 按 key 的 read model job

新增或抽象以下能力：

```text
ensureCoreReadModel(snapshot)
ensureProjectCatalogSummary(snapshot, layer = base|interaction)
ensureProfileDashboard(profile, snapshot)
ensureTeamMetrics(context, snapshot)
ensureTeamSummary(owner, context, year, snapshot)
ensureTeamDetail(owner, context, year, snapshot)
ensureProjectDetail(projectId, snapshot)
```

每个 job 有统一 key：

```text
feature + snapshotHash + params
```

并记录：

```json
{
  "key": "team-work-completion-detail:hash:owner:direct:2026",
  "feature": "team-work-completion-detail",
  "priority": "interaction",
  "status": "preparing",
  "queuedAt": "...",
  "startedAt": "...",
  "finishedAt": "",
  "error": ""
}
```

第一阶段不需要引入复杂持久化队列，可以先用进程内 `Map` + 去重 promise；但 API contract 要先稳定，后续可替换成持久队列。

### 6.5 静态 read model 预压缩

预计算写文件时同步生成：

```text
*.json
*.json.gz
```

server 对 read model 静态命中优先：

```text
Accept-Encoding includes gzip -> stream .json.gz
else -> stream .json
```

日志需要区分：

```json
{
  "servedPrecompressed": true,
  "jsonStringifyMs": 0,
  "gzipMs": 0,
  "fileReadMs": 4,
  "payloadKb": 512
}
```

这一步应在 session 拆小后做。否则只是把大包压快一点，根因仍在。

### 6.6 同步状态机

前端同步状态改为明确状态机：

```text
idle
syncing-source
warming-read-model
reloading-dashboard
ready
cooldown
failed
```

`/api/dashboard-sync` 成功响应建议包含：

```json
{
  "source": "dingtalk",
  "syncedAt": "...",
  "snapshotHash": "...",
  "warmed": true,
  "warmupStatus": {
    "state": "ready",
    "readyFeatures": ["dashboard-session"],
    "pendingFeatures": [],
    "failedFeatures": []
  },
  "features": []
}
```

429 响应建议包含：

```json
{
  "error": "Sync is rate limited",
  "retryAfterMs": 45000,
  "cooldownUntil": "2026-06-13T12:00:00.000Z",
  "inFlight": false
}
```

前端规则：

- `loadDashboard()` 返回 `true` 或结构化 `{ ok: true }` 时，才能显示“已同步”。
- `loadDashboard()` 返回 preparing/false 时，显示“源数据已同步，读模型生成中”。
- 429 显示倒计时，不再只显示“稍后再试”。
- 同步期间保留旧看板，不清空大块 UI。

### 6.7 执行前需要固定的契约选择

正式实现前建议先固定以下选择，后续代码和测试都按这些口径推进：

| 决策点 | 推荐口径 | 原因 |
| --- | --- | --- |
| 默认 session | `/api/dashboard-session` 默认 `include=shell` | 最大限度降低首屏和同步后的等待成本 |
| 过渡兼容 | 保留 `include=projectCatalog/profile/team` 兼容路径 1 个阶段 | 避免一次性打断 direct/franchise/teams 现有页面 |
| incompatible 状态码 | endpoint 可恢复时返回 202，warmup 失败或配置错误返回 503 | 202 表示正在生成，503 表示本轮无法自动恢复 |
| shell 兼容旧模型 | 只允许 shell/core stale-compatible，不允许 team detail stale 覆盖当前 snapshot | 保住首屏可见性，同时不污染负责人完成度 |
| project catalog 字段 | base 字段是首屏硬依赖，interaction 字段可派生或 warming | 避免新提醒字段再次变成首屏硬门槛 |
| 年份过滤 | 默认只取业务有效年份和当前年，异常年份写入 `yearWarnings/excludedYears` | 控制矩阵，同时保留排查证据 |
| `loadDashboard()` 返回值 | Phase 1 可保持 boolean 兼容并增加 `lastDashboardLoadStatus`，Phase 2 再切结构化返回 | 降低第一批修改的调用方影响 |
| 预压缩 | 只用于 read model 静态文件命中，不用于继续放大全量 session | 防止优化方向变成掩盖大包 |

其中 `loadDashboard()` 的返回值要谨慎处理。当前已有调用方把它当 boolean 使用；Phase 1 可以先维持 `true/false`，同时在模块内记录：

```javascript
{
  ok: false,
  status: 'preparing',
  reasonCode: 'incompatible_project_catalog_contract',
  reason: 'project catalog summary workflow fields are missing'
}
```

`syncDingTalk()` 读取这个状态决定提示语。等 Phase 2 拆 apply 边界时，再把返回值正式升级为结构化对象。

## 7. 分阶段执行方案

### Phase 1 - 止血与可解释性

目标：避免用户继续撞到含糊 preparing，并修掉同步误报。

改动范围：

- `src/backend/readModelRepository.mjs`
  - 给 schema/field mismatch 返回更明确 reason，例如 `incompatible_read_model_schema`、`incompatible_project_catalog_contract`。
  - `readDashboardSessionReadModel()` 对 shell/core 和 team detail 的缺失分开判断。
- `src/backend/server.mjs`
  - `/api/dashboard-session` 202 payload 增加 `reasonCode`、`warmupStatus`、`snapshotHash`。
  - `/api/dashboard-warmup` 增加 `readyFeatures/pendingFeatures/failedFeatures`。
- `src/backend/syncGate.mjs`
  - 返回 `retryAfterMs/cooldownUntil/inFlight`。
- `public/lib/dashboard-loader.mjs`
  - `loadDashboard()` 返回结构化结果，或至少让调用方能区分 preparing。
  - `syncDingTalk()` 检查 `loadDashboard()` 返回值。
- `scripts/launch-dev-dashboard.ps1`
  - 默认等待 core warmup ready 后再打开浏览器。
  - 增加显式参数 `-OpenBeforeWarmup` 保留旧行为。
- `scripts/launch-intranet-dashboard.ps1`
  - 保持打开浏览器前必须 ready 的行为，补充日志和失败原因。

验收：

- 当前 schema 8 / 缺 `workflowFacts` 的 read model 会被明确报为 incompatible，并触发 core warmup。
- 同步成功但 session preparing 时，前端不显示“已同步”。
- 开发启动器默认不再打印“warming in the background”后立刻打开页面。

Phase 1 的边界要刻意收窄：

- 不在 Phase 1 删除 `applyDashboardSessionPayload()` 的大包兼容能力。
- 不在 Phase 1 改 direct/franchise/teams 的完整加载路径，只修状态和启动时序。
- 不在 Phase 1 引入持久队列；只允许补充 reasonCode、warmupStatus、retry metadata。
- 若本地 read model incompatible，允许提示重建或自动触发 core warmup，但不要把旧 team detail 当成当前数据。

### Phase 2 - 拆 session 与 apply 边界

目标：让 `/api/dashboard-session` 默认只负责 shell。

改动范围：

- `src/backend/readModelRepository.mjs`
  - 新增 `readDashboardSessionShellReadModel()`。
  - `readDashboardSessionReadModel()` 保留为 include/team 兼容路径，后续逐步退场。
- `src/backend/server.mjs`
  - `/api/dashboard-session` 支持 `include=shell|projectCatalog|profile:direct|team`。
  - 默认 include 为 `shell`。
- `public/lib/dashboard-loader.mjs`
  - 拆出：
    - `applyShellSessionPayload()`
    - `applyProjectCatalogPayload()`
    - `applyProfileDashboardPayload()`
    - `applyTeamBundlePayload()`
  - `loadDashboard()` 先加载 shell，再按当前 page 触发对应 loader。
- `public/pages/profile-shared.mjs`
  - direct/franchise 首次进入不依赖 session 大包填充。
- `public/pages/teams.mjs`
  - 优先读取 team session bundle；缺失时走现有三接口 fallback。

验收：

- `/api/dashboard-session` 默认响应不含 `profileDashboards`、`projectCatalog.items`、`team.workCompletion.projectsById`。
- direct/franchise/details/teams 页面仍能加载完整内容。
- session shell 未 gzip 响应进入明确预算，建议目标不超过 500 KB。

迁移顺序建议：

1. 后端先支持 `include=`，默认仍可短期通过配置开关保留旧 all-in-one。
2. 前端增加 shell apply 与页面局部 apply，但保持旧 payload 可被消费。
3. direct/franchise 改为 shell + profile loader。
4. details 改为 shell + project catalog loader。
5. teams 改为 shell + team bundle/三接口 fallback。
6. 删除默认 all-in-one，只保留显式 include 兼容。

### Phase 3 - 缩预计算矩阵

目标：停止默认生成全量 owner × context × year detail。

改动范围：

- `src/backend/precomputeTeamDashboards.mjs`
  - `COMPLETE_PRECOMPUTE_FEATURES` 拆为 core required 与 optional feature。
  - `precomputeFilesComplete()` 拆成 `coreFilesComplete()`、`teamBundleFilesComplete()`、`projectDetailFilesComplete()`。
  - 默认只生成 summary 和当前 key detail；历史年份/其他 owner/context detail 改为按需。
  - 年份提取增加业务白名单或去噪，避免 `2000` 这类异常年份放大矩阵。
- `src/backend/syncService.mjs`
  - `ensureDashboardPrecompute()` 改为确保 core ready。
  - 新增 `ensureReadModelFeature()` 或按 key ensure 函数。
- `src/backend/server.mjs`
  - team detail read model miss 时只排队该 key，不触发完整 precompute。

验收：

- 默认 `team-work-completion-detail` 文件数不再等于 `owners * contexts * years`。
- 请求未生成的 owner/context/year detail 会快速 202，并只排队该 key。
- 首屏 core ready 不依赖 project detail 和 team detail 全矩阵。

这一阶段要特别防止两个回退：

- 不要把 `team-work-completion-summary` 也过度缩减。summary 体积小，适合支持页面快速扫描。
- 不要让 detail miss 再调用 `ensureDashboardPrecompute()` 的完整路径。miss 只能进入单 key job。

### Phase 4 - 预压缩与静态发送

目标：减少大 read model 命中时的主线程 stringify/gzip 成本。

改动范围：

- `src/backend/precomputeTeamDashboards.mjs`
  - `writeJson()` 增加可选 gzip sidecar。
  - 对 read model 静态 payload 写 `.json.gz`。
- `src/backend/server.mjs`
  - 新增 `sendJsonFile()` 或 `sendReadModelFile()`。
  - read model 静态命中优先 stream 文件。
  - 日志增加 `servedPrecompressed/fileReadMs`。

验收：

- `Accept-Encoding: gzip` 请求可命中 `.json.gz`。
- 大 read model 命中时 `jsonStringifyMs/gzipMs` 不再随 payload 大小线性增长。
- 不暴露 `data/read-model` 目录遍历风险。

### Phase 5 - 性能预算与文档治理

目标：把这次事故变成可执行防线。

改动范围：

- `tests/readModelRepository.test.mjs`
- `tests/precomputeTeamDashboards.test.mjs`
- `tests/teamMetrics.test.mjs`
- `tests/publicAppBehavior.test.mjs`
- `tests/browserSync.test.mjs`
- `tests/syncGate.test.mjs`
- `tests/frontendLoadPerformancePolicy.test.mjs`
- `tests/projectCatalog.test.mjs`
- `AGENTS.md`
- `看板性能架构与防复发治理.md`
- `docs/handbook/operations.md`
- `docs/handbook/git-and-data.md`
- 前端开发文档页 `public/pages/developer-docs.mjs` 或对应渲染源

验收：

- 新增体量预算、状态机、契约兼容、按 key 生成、预压缩发送测试。
- AGENTS 与测试断言不再要求旧的“开发启动器后台 warmup 后立即开浏览器”。
- 文档明确 read model 产物目录、是否入 Git、清理/重建方式。

## 8. 推荐测试清单

### 8.1 Read model 契约测试

文件：`tests/readModelRepository.test.mjs`

新增测试：

- `readDashboardSessionReadModel classifies schema mismatch as incompatible`
- `readDashboardSessionShellReadModel serves compatible shell when optional details are warming`
- `project catalog interaction fields do not block shell session`
- `team detail reader never serves last-known-good detail for current snapshot`

关键断言：

- manifest schema 与 core schema 不一致时 reason 必须包含 schema/snapshot/contract。
- 缺 `workflowFacts` 不应让 shell 不可用，但应让 interaction feature 标记为 preparing 或 repaired。
- team detail 缺失时不能返回 stale detail。

### 8.2 Session 体积预算测试

文件：`tests/teamMetrics.test.mjs` 或新增 `tests/dashboardSessionBudget.test.mjs`

新增测试：

- `/api/dashboard-session default shell stays under payload budget`
- `/api/dashboard-session default shell omits page bundles`
- `/api/dashboard-session include=team returns only requested owner/context/year`

关键断言：

- 默认 shell 不含 `profileDashboards`。
- 默认 shell 不含 `projectCatalog.items`。
- 默认 shell 不含 `team.workCompletion.projectsById`。
- 默认 shell 未 gzip字节数不超过预算。第一阶段可设 750 KB，Phase 2 后收紧到 500 KB。

### 8.3 预计算矩阵预算测试

文件：`tests/precomputeTeamDashboards.test.mjs`

新增测试：

- `precomputeTeamDashboards does not generate full detail matrix by default`
- `team detail missing schedules only requested key`
- `precompute years ignore invalid historical sentinel years`

关键断言：

- 默认 blocking core 不生成全量 detail。
- detail 文件数不等于 `owners * contexts * years`。
- 请求未命中 detail 时，只出现一个 job key。

### 8.4 同步状态机测试

文件：`tests/publicAppBehavior.test.mjs`、`tests/browserSync.test.mjs`、`tests/syncGate.test.mjs`

新增测试：

- `syncDingTalk does not report synced when dashboard session remains preparing`
- `dashboard sync rate limit returns retry metadata`
- `dashboard sync response includes warmupStatus`

关键断言：

- `loadDashboard()` 返回 false/preparing 后不显示“已同步”。
- 429 包含 `retryAfterMs` 和 `cooldownUntil`。
- 成功同步后若 read model 仍 warming，前端显示“读模型生成中”。

### 8.5 静态 gzip 测试

文件：新增 `tests/serverReadModelGzip.test.mjs` 或并入 `tests/teamMetrics.test.mjs`

新增测试：

- `read model static hit serves precompressed gzip when accepted`
- `read model gzip path does not allow directory traversal`

关键断言：

- `content-encoding: gzip`。
- 日志或响应路径能区分 `servedPrecompressed`。
- `../` 路径不能读取 read model 目录外文件。

### 8.6 前端详情降级测试

文件：`tests/projectCatalog.test.mjs`、`tests/projectDetailOpen.test.mjs`

新增测试：

- `fetchProjectDetail returns preparing state for 202 read model response`
- `project detail modal keeps summary when full detail is warming`

关键断言：

- read model 202 不静默变成 null。
- 弹窗显示摘要，并给出“详情生成中”状态。
- 默认 timeout 可收紧到 2 秒或 5 秒，必要时用户重试再允许 compute。

## 9. 需要保留的正确方向

这些已有修复不应回退：

- `team-work-completion` detail read model 请求的短超时策略。
- `teamWorkCompletionHasDetail()` 对 `detailReady === true` 和项目 id 的严格校验。
- `/api/projects?id&view=full&fallback=readModel` 缺失时快速返回 202 的思路。
- drill-down 使用 `fields=ids` + 本地 catalog 拼装，不能退回全量 `/api/projects`。
- `dashboard-session/core.json` 不内嵌 `projectCatalog/profileDashboards` 的磁盘产物方向。
- `sendJson()` 使用 `gzipAsync` 而不是 `gzipSync`。
- 路由层同页 hash/query 不触发页面级重数据 reload 的边界。

## 10. 不建议做的事

- 不建议继续把所有问题归因于“预热没跑完”，然后扩大 warmup 范围。
- 不建议让 `/api/dashboard-session` 默认继续返回 profile/catalog/team 全量，只靠 gzip 缓解。
- 不建议把 project catalog 的每个新功能字段都升级成首屏硬门槛。
- 不建议在 read model miss 时触发完整全局 precompute。
- 不建议用 last-known-good team detail 覆盖当前 snapshot 的负责人完成度。
- 不建议为了修当前慢问题改钉钉源数据字段语义或业务录入校验。

## 11. 文档与规则同步

完成上述方案时，需要同步更新：

| 文件 | 更新内容 |
| --- | --- |
| `AGENTS.md` | 增加 read model 契约、session size、矩阵预算、同步状态机、预压缩规则 |
| `看板性能架构与防复发治理.md` | 更新“当前架构”中 read model 分层、feature contract、按 key job |
| `docs/handbook/operations.md` | 增加 read model incompatible/preparing/failed 的排查和重建流程 |
| `docs/handbook/git-and-data.md` | 明确 `.json.gz`、read-model/current、precomputed 目录是否入库 |
| `public/pages/developer-docs.mjs` | 前端开发文档页补充 read model 分层和状态解释 |
| `tests/frontendLoadPerformancePolicy.test.mjs` | 更新旧的 warmup 后台打开浏览器断言 |
| `tests/frontendSplitPolicy.test.mjs` | 若修改 AGENTS 中 team loader 规则，需要同步断言 |

## 12. 推荐执行顺序

建议按以下顺序实施，避免一次性大改：

1. Phase 1：修同步误报、read model incompatible 分类、启动器等待 core warmup。
2. Phase 2：拆 `/api/dashboard-session` 默认 shell-only，拆前端 apply ownership。
3. Phase 3：缩预计算矩阵，建立按 key detail job。
4. Phase 4：预压缩 read model，静态发送大 payload。
5. Phase 5：补齐体量预算与防复发测试，更新 AGENTS 和文档。

每个阶段都应先写失败测试，再改实现，再跑定向测试。阶段间保持兼容：

- Phase 1 不改变主要 API 形状，只改善状态表达和误报。
- Phase 2 引入 `include=` 过渡，避免一次性打断旧页面。
- Phase 3 保留 summary 多生成，先控制 detail。
- Phase 4 在 session 变小后做，收益更稳定。
- Phase 5 把预算固定下来，避免后续功能再次把首屏做重。

## 13. 第一批最小任务建议

如果马上开工，建议第一批只做 6 件事：

1. 给 `readDashboardSessionReadModel()` 增加 reasonCode，并把 schema 8 缺 `workflowFacts` 明确归类为 `incompatible_project_catalog_contract`。
2. 修 `syncDingTalk()`：`loadDashboard()` 返回 false/preparing 时，不显示“已同步”。
3. 给 `syncGate` 的 429 返回 `retryAfterMs/cooldownUntil`。
4. 改 `scripts/launch-dev-dashboard.ps1` 默认等待 `/api/dashboard-warmup` ready 再开页面，旧行为改为显式参数。
5. 新增 `publicAppBehavior` 同步误报测试和 `readModelRepository` incompatible 测试。
6. 在文档中标记当前 `data/read-model/current` schema 8 为需要重建的 incompatible read model，避免继续误判为网络或浏览器问题。

这一批完成后，用户至少会看到准确状态，开发启动不会先打开一个注定 preparing 的页面，也不会在同步后误以为页面已刷新完成。

## 14. 阶段验收定义

每个阶段结束时，都应同时满足“功能可用、体量受控、状态可解释”三类验收。

### 14.1 Phase 1 Done

- `/api/dashboard-session` 对当前 schema 8 缺 `workflowFacts` 的 read model 返回明确 `reasonCode`。
- `/api/dashboard-warmup` 返回 `readyFeatures/pendingFeatures/failedFeatures`。
- `/api/dashboard-sync` 429 返回 `retryAfterMs/cooldownUntil`。
- `syncDingTalk()` 不再在 `loadDashboard()` false/preparing 后显示“已同步”。
- 开发启动器默认等待 core warmup ready 后再打开浏览器，旧行为必须显式参数启用。
- 定向测试至少覆盖：
  - `tests/readModelRepository.test.mjs`
  - `tests/publicAppBehavior.test.mjs`
  - `tests/browserSync.test.mjs`
  - `tests/syncGate.test.mjs`
  - `tests/frontendLoadPerformancePolicy.test.mjs`

### 14.2 Phase 2 Done

- `/api/dashboard-session` 默认 shell-only。
- 默认 shell 响应不含 `profileDashboards`、`projectCatalog.items`、`team.workCompletion.projectsById`。
- direct/franchise/details/teams 首次进入仍可加载完整内容。
- `applyDashboardSessionPayload()` 已拆分 ownership，或至少默认 shell apply 不写 profile/catalog/team 大块。
- 默认 shell 未 gzip payload 小于预算。建议阶段目标：500 KB；若实际字段仍需过渡，必须在测试里写明临时预算和收紧计划。

### 14.3 Phase 3 Done

- 默认 precompute 不生成全量 team detail 矩阵。
- team detail miss 只排队请求 key。
- `hasCompletePrecompute()` 不再作为所有 endpoint 的唯一 ready 判断。
- `years` 异常值不会静默扩大矩阵；异常年份有日志或 manifest 记录。
- 当前 owner/context/year 的默认 team detail 仍可快速命中。

### 14.4 Phase 4 Done

- read model 静态命中支持 `.json.gz`。
- 大静态 read model 响应日志中 `servedPrecompressed=true`，`jsonStringifyMs/gzipMs` 不再承担主要成本。
- 路径校验防止读取 read model 目录外文件。

### 14.5 Phase 5 Done

- AGENTS、性能治理文档、运维手册和 Git/数据规范已同步。
- 预算测试覆盖 session size、矩阵文件数、schema mismatch、sync 状态机、gzip 静态发送。
- `npm test` 或定向测试组合通过。

## 15. 回滚与恢复策略

由于 read model 是本地运行产物，修复时要给实现留回滚路径：

| 场景 | 回滚/恢复动作 |
| --- | --- |
| Phase 1 状态字段导致旧前端不识别 | 保持原有 `status: preparing` 和 `reason` 字段，只新增 `reasonCode/warmupStatus` |
| Phase 2 shell-only 影响页面加载 | 临时通过 `include=all` 或配置开关恢复旧 all-in-one，同时保留新测试标记为过渡 |
| Phase 3 按需 detail 影响团队页速度 | 只恢复当前 owner/context/year 的 eager detail，不恢复全 owner/context/year 矩阵 |
| 预压缩发送异常 | 回退到 `sendJson()` 动态响应，但保留 session 拆分成果 |
| 本地 read model incompatible | 删除或重建 `data/read-model/current`，保留 `last-known-good` 仅供 shell/core 兼容参考 |

回滚原则：

- 可以回滚新 endpoint 选择，但不要回滚“状态表达准确”。
- 可以临时恢复显式 include 大包，但不要恢复默认 all-in-one。
- 可以恢复当前 key eager detail，但不要恢复完整矩阵。

## 16. 执行时的建议命令

按阶段执行时优先跑定向测试，避免每一步都全量等待：

```powershell
npm test -- tests/readModelRepository.test.mjs tests/syncGate.test.mjs
npm test -- tests/browserSync.test.mjs tests/publicAppBehavior.test.mjs
npm test -- tests/frontendLoadPerformancePolicy.test.mjs tests/precomputeTeamDashboards.test.mjs
```

如果某阶段改了 `server.mjs` 的 API 行为，再补跑：

```powershell
npm test -- tests/teamMetrics.test.mjs tests/teamWorkCompletionApi.test.mjs tests/projectDetailApi.test.mjs
```

如果改了启动器脚本，再补跑：

```powershell
npm test -- tests/run-dev-bat.test.mjs tests/frontendLoadPerformancePolicy.test.mjs
```

最终收尾前再跑：

```powershell
npm test
```

若需要本地页面验收，必须复用用户已打开的 Chrome 项目页，并按仓库 AGENTS 的 Chrome Extension 路线截图；不要为视觉验收新开浏览器或新 target。
