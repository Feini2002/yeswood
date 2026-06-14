# yeswood 运营看板 SaaS 化稳定性修复方案

> 适用仓库：`Feini2002/yeswood`  
> 目标页面：首页、小组页、项目列表、项目详情弹窗、团队工作完成情况弹窗  
> 核心目标：把系统从“页面需要数据时现场拉、现场算、现场等”，改成“用户交互只读轻量 read path；后台刷新永不清空当前可见内容；warmup 只是加速，不是可用性的前置条件”。

---

## 1. 是否需要扩大修复范围

需要，而且必须扩大。

这次问题不应继续按“某个接口慢”或“某个弹窗 loading 不好看”处理。用户看到的是一个整体体验：

- 首页能较快出现，但后续交互经常等待。
- 冷启动后 3～5 分钟才恢复可用。
- 页面打开很久后也可能重新进入 loading。
- Codex 改代码、服务重启、dev reload、自动刷新、read model repair 都可能把已打开页面打回 loading。
- 小组页已在当前 route，但两个核心模块显示“正在读取 / 正在切换小组数据”。
- 顶部出现“刷新中”或曾残留 `Dashboard boot failed`。

所以修复范围必须从“小组页弹窗 detail 预热”扩大到：

1. 冷启动契约。
2. 运行期状态稳定契约。
3. read-model feature/scope 契约。
4. API 普通读路径收口。
5. 前端 stale-while-revalidate 状态机。
6. 小组页 owner/context/year 切换保护。
7. 项目列表和项目详情弹窗的 shell/detail 分离。
8. dev reload / service restart 状态恢复。
9. 错误隔离。
10. payload 预算、静态 gzip、观测与测试防复发。

一句话：**这不是一次性能优化，而是一次 SaaS 化可用性治理。**

---

## 2. 目标体验契约

### 2.1 冷启动契约

BAT 打开后 0～30 秒内，以下内容必须可用：

- 首页。
- 小组页。
- 项目列表。
- 项目详情弹窗。
- 团队工作完成情况弹窗。

规则：

- warmup 只能优化速度，不能决定页面能不能用。
- `read-model/current` 缺片时，应读 `last-known-good` 或轻量 shell。
- current 与 LKG 都不可用时，页面仍应打开 shell，并显示模块级 preparing。
- 禁止首屏、页面切换、弹窗点击路径触发全量 snapshot compute。

### 2.2 运行期稳定契约

页面已有任何可见业务数据后：

- 后台刷新不能清空页面。
- read model repair 不能清空页面。
- dev reload 不能让页面永久空等。
- auto update 不能先 invalidate 当前可见内容。
- service restart 不能让前端永久停在 loading。
- sync polling 不能显示“已同步”但 read model 仍未 ready。

正确行为：

- 旧内容继续展示。
- 模块角标显示“刷新中 / 正在切换 / read-model 生成中”。
- 新数据完整回来后原位替换。
- 失败时保留旧内容并显示“刷新失败，可重试”。

### 2.3 小组页交互契约

进入小组页后，当前 `owner/context/year` 的 detail 应在用户点击前准备好。

正常路径：

- 点击小组 / 成员 / 月份弹窗时不发 `view=detail` 请求。
- 弹窗点击路径只读 `state/cache`。
- 最多做轻量筛选、排序、映射。
- 项目行直接出现。

异常兜底：

- 如果 detail 缺失，弹窗仍先打开标题、计数、筛选卡。
- 只有项目行区域局部 pending。
- 只允许请求 `view=detail&fallback=readModel`。
- `view=detail` 缺失时必须快速返回 `202 preparing`，不得等待 8 秒以上。
- 禁止用户点击路径使用 `fallback=compute`。

### 2.4 项目列表 / 项目详情契约

- 项目列表普通读取走 project catalog summary read model。
- 项目详情弹窗先打开 summary shell。
- full detail 读 read model；缺失时局部 preparing 并触发 scoped repair。
- 项目详情点击路径也禁止现场 compute。

---

## 3. 根因树

### 3.1 后端 read-model 根因

当前系统虽然已有 sidecar 和 current read model，但契约仍偏 all-or-nothing：

- shell、summary、detail、project catalog、project detail、team metrics、responsibility review 没有完全分层。
- owner dashboard-session 对当前 scope 的 detail 缺片过于敏感。
- 单个 owner/context/year detail 缺失可能让整个 owner session 返回 preparing。
- 默认预计算仍容易扩散到 owner × context × year 矩阵。
- read-model 命中后仍可能 parse、merge、stringify 大对象，而不是直接静态 sidecar 直出。

### 3.2 API 根因

- `/api/dashboard-session` 应是 shell-first，但 owner 请求仍需要更明确的 partial-ready 契约。
- `/api/team-work-completion?view=detail` 已有 read model 快路径，但 `fallback=compute` 仍存在，必须从 UI 路径隔离。
- `/api/projects?view=full` 应作为详情 read model 读取，不应回退大包。
- 运行期刷新接口缺少“返回 partial + status，而不是等待”的统一约定。

### 3.3 前端状态根因

- 小组页仍有路径在目标 scope 缓存缺失时把当前模块置空。
- loading 渲染函数具有破坏性，会清空面板。
- `hasVisibleDashboardData()` 对小组页可见数据判断不足。
- route scope 与 visible data ownership 未完全解耦。
- 自动刷新 / sync / dev reload 仍可触发页面级 reload 或 force refresh。

### 3.4 开发态根因

用户经常一边开页面一边让 Codex 修改代码。

开发态目前必须按产品态保护：

- 代码变更不能总是裸 `location.reload()`。
- 即使必须 reload，也要保存并恢复 route、owner、context、year 和当前页面数据。
- 服务短暂重启不能让页面永久 loading。

### 3.5 错误隔离根因

- 全局 boot error 面板可能残留。
- 一个模块错误不能升级为全局 `Dashboard boot failed`。
- 可恢复错误应模块级展示、自动重试或允许局部重试。

---

## 4. 总体架构方案

### 4.1 三层 read path

#### Layer A：Shell read path

用于首页首屏和 app boot。

包含：

- snapshot meta。
- runtime flags。
- filters。
- department metrics。
- owner directory。
- 基础 profile metrics。

不包含：

- 全量 project catalog items。
- full project detail。
- 全 owner team completion detail。
- 大型 projectsById。

#### Layer B：Visible scope read path

用于当前页面当前 scope。

例如小组页当前：

```text
owner = 苏佳蕾
context = direct
year = 2026
```

应准备：

- team metrics。
- team work completion summary。
- team work completion detail。
- owner responsibility review。

只处理当前页面当前 scope，不预热所有负责人。

#### Layer C：Interaction read path

用于弹窗点击。

正常情况下只读 state/cache：

- `state.teamWorkCompletion.projectsById`
- `state.teamWorkCompletion.sourceProjects`
- `state.projectDetailsById`
- project catalog summary cache

禁止：

- 现场 getSnapshot。
- 现场 build detail。
- 用户点击时 fallback compute。

---

## 5. 后端修复方案

### 5.1 新增 feature-level read model contract

新增 read model contract 文件，例如：

```text
src/backend/readModelContracts.mjs
```

定义：

```js
export const READ_MODEL_FEATURES = {
  DASHBOARD_SHELL: 'dashboard-session',
  PROJECT_CATALOG_SUMMARY: 'project-catalog-summary',
  PROJECT_DETAIL: 'project-detail',
  PROFILE_DASHBOARD: 'profile-dashboard',
  TEAM_METRICS: 'team-metrics',
  TEAM_WORK_COMPLETION_SUMMARY: 'team-work-completion-summary',
  TEAM_WORK_COMPLETION_DETAIL: 'team-work-completion-detail',
  TEAM_RESPONSIBILITY_REVIEW: 'team-responsibility-review',
};

export const FEATURE_CONTRACTS = {
  dashboardShell: [READ_MODEL_FEATURES.DASHBOARD_SHELL],
  projectCatalogSummary: [READ_MODEL_FEATURES.PROJECT_CATALOG_SUMMARY],
  projectDetail: [READ_MODEL_FEATURES.PROJECT_DETAIL],
  teamWorkCompletionSummary: [READ_MODEL_FEATURES.TEAM_WORK_COMPLETION_SUMMARY],
  teamWorkCompletionDetail: [
    READ_MODEL_FEATURES.TEAM_WORK_COMPLETION_SUMMARY,
    READ_MODEL_FEATURES.TEAM_WORK_COMPLETION_DETAIL,
  ],
  teamScopeBundle: [
    READ_MODEL_FEATURES.DASHBOARD_SHELL,
    READ_MODEL_FEATURES.TEAM_METRICS,
    READ_MODEL_FEATURES.TEAM_WORK_COMPLETION_SUMMARY,
    READ_MODEL_FEATURES.TEAM_RESPONSIBILITY_REVIEW,
  ],
  teamScopeBundleWithDetail: [
    READ_MODEL_FEATURES.DASHBOARD_SHELL,
    READ_MODEL_FEATURES.TEAM_METRICS,
    READ_MODEL_FEATURES.TEAM_WORK_COMPLETION_SUMMARY,
    READ_MODEL_FEATURES.TEAM_WORK_COMPLETION_DETAIL,
    READ_MODEL_FEATURES.TEAM_RESPONSIBILITY_REVIEW,
  ],
};
```

目标：

- 不再用一个 `REQUIRED_READ_MODEL_FEATURES` 判断所有读取。
- shell 缺 project detail 不应不可用。
- team detail 缺 project detail 不应不可用。
- project detail 缺片不应拖垮 dashboard shell。

### 5.2 改造 dashboard-session：支持 partial team bundle

新增：

```js
readDashboardSessionScopeReadModel(config, params, options)
```

返回：

```js
{
  status: 'ready' | 'partial' | 'stale' | 'preparing',
  payload: {
    readModel: true,
    shellOnly: false,
    snapshot,
    metrics,
    departmentMetrics,
    team: {
      owner,
      dashboardContext,
      year,
      metrics,
      workCompletion,
      responsibilityReview,
      readiness: {
        metrics: 'ready',
        workCompletionSummary: 'ready',
        workCompletionDetail: 'preparing',
        responsibilityReview: 'ready'
      }
    }
  },
  missing: ['team-work-completion-detail'],
  repairScheduled: true
}
```

规则：

- shell + summary + metrics 可读时，返回 200。
- detail 缺失时，`team.workCompletion.detailReady=false`，但不让整个 session 202。
- detail ready 时，dashboard-session 直接 merge summary + detail。
- 只有 shell/current/LKG 均不可用时，才 202 preparing。

### 5.3 `/api/dashboard-session` 行为

#### 无 owner 请求

保持 shell-first：

```http
GET /api/dashboard-session?context=direct&year=2026
```

返回 shell，不拼接大包。

#### 有 owner 请求

```http
GET /api/dashboard-session?owner=苏佳蕾&context=direct&year=2026
```

返回当前 scope bundle：

- 200 ready：summary + detail + metrics + responsibility 都可用。
- 200 partial：summary/metrics 可用，detail 缺失，repair 已触发。
- 200 stale：current 缺片，但 LKG 可用。
- 202 preparing：无 current、无 LKG、无 shell。

禁止：

- 因一个 detail 缺片让整个 owner session 202。
- 因 owner session 202 导致前端整页清空。

### 5.4 `/api/team-work-completion` 收口

#### summary

```http
GET /api/team-work-completion?owner=苏佳蕾&context=direct&year=2026
```

规则：

- 优先 current summary sidecar。
- current miss 读 LKG stale。
- 仍 miss 才轻量 summary compute 或 shell summary。
- 触发 scoped repair。
- 不先 `getSnapshot()`，除非进入明确 fallback/repair。

#### detail

```http
GET /api/team-work-completion?owner=苏佳蕾&context=direct&year=2026&view=detail&fallback=readModel
```

规则：

- current detail 命中：200。
- LKG detail 命中：200 stale。
- miss：触发 scoped repair，快速 202 preparing。
- 不能等 repair 完成。
- 不能现场 compute。

#### compute 保护

保留管理员/测试能力，但 UI 不可用：

```http
GET /api/team-work-completion?...&view=detail&fallback=compute
x-dashboard-action: force-compute
```

没有专用 header 或 debug flag 时返回 403/400。

### 5.5 scoped repair 不升级为 full precompute

当前修复方向应统一为 single-key job：

```js
repairTeamWorkCompletionReadModelSidecars(snapshot, {
  owner,
  dashboardContext,
  year,
  today,
})
```

约束：

- 单个 owner/context/year 缺片只修单个 key。
- 单个 project detail 缺片只修单个 project。
- 不把局部 miss 升级为完整 owner × context × year 全矩阵。
- scoped repair 必须 in-flight 去重。
- repair 结果晚返回不能污染当前 snapshot/current。

### 5.6 read-model 发布改成“永不拔掉 current”

短期改法：

- 生成新目录。
- 校验新目录 shell/core 必备文件。
- 校验当前 visible scope sidecar。
- 校验 `.json.gz`。
- 校验成功后再替换 current。
- 替换失败时保留旧 current。

长期推荐：

```text
read-model/
  versions/
    <snapshotHash>-<generatedAt>/
  current-pointer.json
  last-known-good-pointer.json
```

指针原子替换，避免 current 目录短暂缺失。

### 5.7 静态 gzip 直出

大型 read-model 文件应走：

```text
Accept-Encoding: gzip -> stream *.json.gz
else -> stream *.json
```

要求：

- API log 增加 `servedPrecompressed`。
- HEAD 不构造 body。
- ETag 支持 304。
- 大响应不 runtime gzip。
- 大响应不重复 stringify。

### 5.8 API payload 预算

建议硬预算：

| API | 目标 | 硬上限 | 说明 |
| --- | ---: | ---: | --- |
| `/api/dashboard-session` shell | < 300KB | 512KB | 不含 page bundles |
| `/api/dashboard-session?owner=...` | < 512KB | 768KB | 只含当前 scope |
| `/api/team-work-completion` summary | < 150KB | 256KB | 不含 projectsById/sourceProjects |
| `/api/team-work-completion?view=detail` | < 512KB | 768KB | 超限则拆分 sidecar |
| `/api/projects?view=summary` | < 512KB | 768KB | 不含 rawFields |
| `/api/projects?id=...&view=full` | < 256KB | 512KB | 单项目 detail |

超过 512KB 的动态响应必须拆分或改 sidecar。

---

## 6. 前端修复方案

### 6.1 统一 stale-while-revalidate 状态机

新增通用状态：

```js
{
  data,
  visibleData,
  targetScope,
  visibleScope,
  status: 'idle' | 'loading' | 'ready' | 'refreshing' | 'switching' | 'preparing' | 'stale' | 'error',
  error,
  updatedAt,
  requestId,
}
```

规则：

- `visibleData` 永远优先保留。
- `targetScope` 变化不立即清空 `visibleData`。
- 新数据 ready 后 atomic swap。
- 失败时 status=error/stale，但 visibleData 不变。

### 6.2 小组页 owner/context/year 切换

当前 scope 切换逻辑应改为：

1. 解析目标 owner/context/year。
2. 生成 requestId + route tuple。
3. 先查目标 scope cache。
4. 命中：显示目标缓存，并标记 refreshing。
5. 未命中：保留当前 visible 内容，标记 switching。
6. 后台请求 dashboard-session scope bundle。
7. 返回时校验 requestId + route tuple。
8. 只在仍是当前目标时写 state。
9. 失败时保留旧内容，显示“切换失败，可重试”。

禁止：

- 切换开始时 `state.teamWorkCompletion = null`。
- 切换开始时 `state.teamMetrics = null`。
- loading renderer 清空旧面板。

### 6.3 小组页模块 loading 拆分

把 destructive loading 拆成：

```js
renderTeamDashboardInitialLoading(owner)
renderTeamDashboardRefreshing(metrics, status)
renderTeamWorkCompletionInitialLoading(owner)
renderTeamWorkCompletionRefreshing(review, status)
renderOwnerReviewInitialLoading(owner)
renderOwnerReviewRefreshing(review, status)
```

规则：

- Initial loading 只用于首次无任何旧数据。
- Refreshing/switching 必须继续渲染旧内容。
- UI 顶部 chip 显示：
  - `刷新中`
  - `正在切换到 苏佳蕾`
  - `读模型生成中，当前显示上次结果`
  - `刷新失败，显示上次结果`

### 6.4 `hasVisibleDashboardData()` 修复

当前小组页已有数据时，也要返回 true：

```js
function hasVisibleDashboardData(pageId = currentPageId()) {
  if (pageId === 'teams') {
    return Boolean(
      state.teamMetrics?.owner ||
      state.teamWorkCompletion?.owner ||
      state.ownerReview?.owner
    );
  }
  if (pageId === 'details') {
    return Boolean(state.projects?.length || state.allProjects?.length);
  }
  return Boolean(state.snapshot) && (Boolean(state.metrics) || Boolean(state.profileMetrics?.department));
}
```

### 6.5 团队工作完成情况 detail 点击前准备

进入小组页后，当前 owner/context/year 应执行：

```js
ensureCurrentTeamWorkCompletionDetailReady({
  reason: 'team-scope-visible',
  allowCompute: false,
  maxAgeMs: 5 * 60 * 1000,
});
```

调用点：

- dashboard-session scope bundle 应用后。
- summary fallback 成功后。
- owner/context/year 切换成功后。
- app 从 sessionStorage 恢复后。

正常验收：

- 首次点击小组 / 成员 / 月份弹窗时，不触发 detail 请求。

异常兜底：

- 如果点击时 detail 缺失，记录 `modal-cold-click` warning。
- 弹窗壳立即打开。
- 项目行局部 pending。
- 只发 `fallback=readModel`。

### 6.6 弹窗只读 cache

弹窗打开函数：

- `openTeamCompletionGroupModal`
- `openTeamCompletionMemberModal`
- `openTeamCompletionMonthModal`
- `openTeamCompletionScopeModal`

正常路径只做：

- 从 `state.teamWorkCompletion` 取 scope。
- 从 `projectsById` 映射项目行。
- 本地 filter/sort。
- 渲染。

不做：

- fetch detail。
- compute detail。
- getSnapshot。
- 依赖全局 loading。

### 6.7 自动更新改两阶段提交

当前 auto update 应从：

```js
invalidateProjectCaches();
await loadDashboard({ snapshot: nextSnapshot, forceRefresh: true });
```

改成：

```js
const previousVisibleState = captureVisibleState();
markRefreshStatus('refreshing');
const next = await loadDashboard({ snapshot: nextSnapshot, background: true, preserveVisibleData: true });
if (next.ready) {
  applyReplacementAtomically(next);
} else {
  restoreVisibleState(previousVisibleState);
  markRefreshStatus('preparing');
}
```

禁止先清空 catalog、projects、team modules。

### 6.8 sync 改两阶段提交

sync 后：

- 源数据同步成功但 read model preparing：显示“数据已同步，读模型生成中”。
- 当前页面保留旧数据。
- scoped read model ready 后再原位替换。
- sync 失败保留旧数据。

### 6.9 dev reload 状态保护

收到 dev reload 事件前：

```js
persistDashboardRuntimeState({ reason: 'dev-reload' });
```

保存：

- route/hash。
- snapshot meta。
- metrics。
- profileMetrics。
- allProjects / catalog signature。
- selectedTeamOwner。
- teamWorkCompletionYear。
- teamMetrics。
- teamWorkCompletion。
- ownerReview。
- teamWorkCompletionByKey。
- ownerReviewByKey。
- teamMetricsByOwner。
- modal open state。

boot 时：

```js
restoreDashboardRuntimeState();
renderRestoredRouteImmediately();
loadDashboard({ background: true, preserveVisibleData: true });
```

如果服务未恢复：

- 保留旧页面。
- 显示“服务重连中”。
- 定时探测 `/api/runtime` 或 `/api/health`。
- 恢复后局部刷新。

### 6.10 刷新按钮改软刷新

普通“刷新”按钮不再 `window.location.reload()`。

改为：

```js
refreshCurrentPage() -> hardRefresh({ preserveVisibleData: true })
```

另设开发态“重载应用”入口，供真实 reload 使用。

---

## 7. 项目列表和项目详情弹窗修复

### 7.1 项目列表

- 默认走 `/api/projects?view=summary` read model。
- catalog miss 时可使用 LKG。
- replacement catalog ready 前保留 `state.allProjects`。
- filter/search/hash 变化只做本地 softRefresh。
- complex filter 要有 generation guard，旧请求不得覆盖新筛选。

### 7.2 项目详情弹窗

打开时：

1. 使用 summary row 立即打开 shell。
2. 项目名称、店态、负责人、当前阶段先显示。
3. full detail 区域局部 loading。
4. 读 `project-detail` read model。
5. miss 则快速 202，触发 scoped repair。
6. 失败保留 shell，显示 detail 局部失败。

禁止：

- 项目详情弹窗阻塞打开。
- 点击详情时请求全量 `/api/projects`。
- 点击详情时 fallback compute。

---

## 8. 错误隔离方案

### 8.1 boot error 生命周期

`Dashboard boot failed` 只在 app module 无法初始化时出现。

app 初始化成功后：

```js
window.__DASHBOARD_BOOTED__ = true;
document.getElementById('dashboard-boot-error')?.remove();
```

boot 后的错误不再渲染 boot failed。

### 8.2 页面级 boundary

每个页面外壳有 page boundary：

- overview boundary。
- teams boundary。
- details boundary。
- profile boundary。

页面级错误不能影响导航、顶部状态、其它页面。

### 8.3 模块级 fallback

小组页至少拆三块：

- team metrics fallback。
- team work completion fallback。
- owner responsibility review fallback。

一个模块失败，另外两个继续展示。

### 8.4 可恢复错误

可恢复错误显示：

- “刷新失败，当前显示上次结果”。
- “重试”按钮。
- 错误详情只在开发态展开。

---

## 9. 服务重启 / 运行期重连方案

新增 runtime monitor：

```http
GET /api/runtime
```

前端记录：

- current runtime pid。
- startedAt。
- commit。
- readModel status。

当 runtime 变化：

- 不清空页面。
- 显示“服务已重启，正在恢复当前页面”。
- 背景重新拉 shell/session。
- 失败保留旧数据。

当请求网络失败：

- 标记 offline/reconnecting。
- 不渲染整页 error。
- 指数退避重试。

---

## 10. 观测与日志

### 10.1 API performance log

所有关键 API 记录：

```js
{
  route,
  owner,
  context,
  year,
  view,
  statusCode,
  readModelHit,
  staleHit,
  partialHit,
  repairScheduled,
  fallbackComputed,
  snapshotMs,
  fileReadMs,
  jsonParseMs,
  jsonStringifyMs,
  gzipMs,
  payloadKb,
  servedPrecompressed,
  totalMs,
}
```

### 10.2 前端 event log

开发态记录：

- route change。
- scope switch。
- dashboard-session preparing。
- stale response ignored。
- module kept stale data。
- modal cold detail request。
- dev reload restore。
- service reconnect。

### 10.3 验收用指标

必须能从日志判断：

- 首次弹窗点击是否触发 detail 请求。
- detail 请求是否 fallback compute。
- owner session 是否返回 partial。
- 运行期刷新是否清空 visible data。
- payload 是否超预算。

---

## 11. 实施阶段

### Phase 0：防继续恶化

目标：先禁止新增 destructive loading 和 compute 点击路径。

任务：

- 加前端静态测试：UI 代码不得出现 `fallback=compute`。
- 加测试：`refreshCurrentPage()` 不得调用 `window.location.reload()`。
- 加测试：teams loading renderer 不得在已有 review 时清空内容。
- 加测试：dev reload 需要保存状态。

### Phase 1：运行期不清空

目标：页面已有数据后，任何 refresh/reload/repair 都不能清空。

任务：

- 改 `hasVisibleDashboardData()`。
- 改小组页 owner/context/year 切换状态。
- 改 `renderTeamDashboardLoading()`。
- 改 `renderTeamWorkCompletionLoading()`。
- 改 auto update 两阶段提交。
- 改 sync 两阶段提交。
- 改刷新按钮软刷新。

验收：

- 已有小组数据时触发后台 refresh，不清空内容。
- dashboard-session preparing 时保留旧内容。
- owner/context/year 切换目标无缓存时保留旧内容。

### Phase 2：dashboard-session partial ready

目标：owner session 不因 detail 缺片整体 202。

任务：

- 新增 feature/scope contract。
- 新增 `readDashboardSessionScopeReadModel()`。
- owner session 返回 200 partial。
- detail 缺失触发 scoped repair。
- detail ready 时 session 直接携带 merged detail。

验收：

- current owner/context/year detail ready 时，小组页 state 直接有 `detailReady=true`。
- detail missing 时 session 200 partial，不清空页面。

### Phase 3：点击前 detail ready

目标：正常首次点击弹窗不再请求 detail。

任务：

- 当前 scope visible 后立即 ensure detail。
- 弹窗点击只读 cache。
- modal-cold-click 打 warning。
- 缺片异常路径项目行局部 pending。

验收：

- 首次点击小组 / 成员 / 月份弹窗，Network 无 `view=detail`。
- 缺片时只发 `fallback=readModel`，快速 202。

### Phase 4：dev reload / service restart 恢复

目标：开发态像产品一样保护状态。

任务：

- dev reload 前保存状态。
- boot 时恢复状态。
- service runtime 变化时 background refresh。
- 服务不可用时保留旧页面并显示 reconnecting。

验收：

- Codex 修改 public 文件触发 reload 后，小组页恢复 route、owner、context、year 和旧内容。
- 服务重启后不永久 loading。

### Phase 5：payload 与静态传输

目标：大响应不再请求时 stringify/gzip。

任务：

- 大型 read-model API 接入 `.json.gz` 直出。
- HEAD 不构造 body。
- 加 payload budget tests。
- 超限 endpoint 拆 sidecar。

验收：

- 大 payload 不触发 runtime gzip。
- API 日志显示 `servedPrecompressed=true`。
- payload 超预算测试失败。

### Phase 6：错误隔离

目标：一个模块错误不污染全局。

任务：

- boot error 成功后清除。
- 页面级 boundary。
- 模块级 fallback。
- 可恢复错误局部 retry。

验收：

- profile-shared 或 team-work-completion 报错不出现全局 Dashboard boot failed。
- 错误修复后 error block 自动消失。

---

## 12. 文件级修改清单

### 后端

#### `src/backend/readModelRepository.mjs`

- 拆 `REQUIRED_READ_MODEL_FEATURES`。
- 新增 feature contract。
- 新增 scope bundle reader。
- detail reader 不依赖全局 complete。
- summary/detail 支持 allowStale 默认 UI 可用。

#### `src/backend/server.mjs`

- `/api/dashboard-session` 支持 200 partial。
- `/api/team-work-completion?view=detail` 缺失快速 202。
- `fallback=compute` 增加保护。
- 大型 read-model API 接入 precompressed send。
- API log 增加 partial/stale/repair/payload/transport 字段。

#### `src/backend/precomputeTeamDashboards.mjs`

- 拆 boot lane / visible scope lane / idle lane。
- 默认不生成所有 owner detail 矩阵。
- scoped repair 不升级 full precompute。
- read-model 发布不拔 current。

#### `src/backend/syncService.mjs`

- sync 状态明确区分 source synced 与 read model ready。
- preparing 不伪装为 synced ready。

### 前端

#### `public/lib/dashboard-loader.mjs`

- `hasVisibleDashboardData()` 纳入 teams/details。
- `refreshCurrentPage()` 改软刷新。
- auto update 两阶段提交。
- sync 两阶段提交。
- `loadDashboard()` 支持 preserveVisibleData/background。

#### `public/pages/teams.mjs`

- owner/context/year 切换 cache-first。
- 目标无缓存时保留旧内容。
- requestId + route tuple guard 完整覆盖。
- `loadTeamWorkCompletion()` 不再跨 owner 清空。
- `renderTeamDashboardLoading()` 非 destructive。

#### `public/pages/team-work-completion.mjs`

- `renderTeamWorkCompletionLoading()` 拆 initial/refreshing。
- 弹窗正常路径只读 cache。
- modal-cold-click 仅异常兜底并打 warning。
- 项目行 pending 局部化。
- detail retry 只用 `fallback=readModel`。

#### `public/realtime.js`

- dev reload 前保存状态。
- 可配置 soft reload / hard reload。
- error reconnect 不触发整页清空。

#### `public/boot.js`

- boot 成功后清除 error panel。
- boot 后错误不渲染 Dashboard boot failed。

#### `public/domain/project-catalog.mjs`

- replacement catalog two-phase swap。
- complex filter generation guard。
- stale request 不写 fresh。

#### `public/components/project-detail-modal.mjs`

- 详情弹窗 shell-first。
- full detail 局部 loading。
- read-model missing 快速 pending。

---

## 13. 自动化测试矩阵

### 13.1 冷启动测试

新增：

```text
tests/coldStartAvailability.test.mjs
```

用例：

- current read model missing，首页仍可 shell render。
- current shell ready、detail missing，小组页可 render。
- BAT 0～30 秒内 dashboard-session shell 不阻塞 full precompute。
- project detail missing 时弹窗 shell 打开。

### 13.2 运行期稳定测试

扩展：

```text
tests/publicAppBehavior.test.mjs
```

用例：

- 已有小组数据时 `loadDashboard({ forceRefresh:true })` 不清空模块。
- dashboard-session preparing 时保留旧 teams 内容。
- owner/context/year 切换目标无缓存时保留旧内容。
- 旧 owner 晚返回不覆盖新 owner。
- sync preparing 显示 read-model 生成中，不显示已同步 ready。

### 13.3 弹窗交互测试

新增：

```text
tests/teamWorkCompletionModalInteraction.test.mjs
```

用例：

- detailReady=true 时首次打开 group/member/month 弹窗不 fetch。
- detailReady=false 时弹窗壳打开，项目行局部 pending。
- detail missing 只请求 `fallback=readModel`。
- 前端 bundle 不包含 `fallback=compute`。

### 13.4 API contract 测试

扩展：

```text
tests/teamWorkCompletionApi.test.mjs
tests/readModelRepository.test.mjs
tests/dashboardSessionBudget.test.mjs
```

用例：

- owner dashboard-session summary ready/detail missing 返回 200 partial。
- owner dashboard-session detail ready 返回 merged detail。
- `view=detail&fallback=readModel` miss 快速 202。
- `fallback=compute` 无授权被拒绝。
- summary fast path 不先 getSnapshot。
- detail reader 不依赖全局 complete。

### 13.5 dev reload / service restart 测试

扩展：

```text
tests/realtime.test.mjs
tests/browserSync.test.mjs
tests/runtimeApi.test.mjs
```

用例：

- dev reload 前保存 state。
- reload 后恢复 route/owner/context/year。
- service runtime 变化不清空页面。
- 服务短暂不可用显示 reconnecting，旧内容保留。

### 13.6 payload / gzip 测试

扩展：

```text
tests/serverReadModelGzip.test.mjs
tests/frontendLoadPerformancePolicy.test.mjs
```

用例：

- `.json.gz` 直出。
- HEAD 不 stringify 大 body。
- 大响应不 runtime gzip。
- dashboard-session shell payload 小于预算。
- owner session 超预算测试失败。

### 13.7 错误隔离测试

新增或扩展：

```text
tests/bootGuard.test.mjs
tests/moduleErrorBoundary.test.mjs
```

用例：

- boot 成功后 error panel 被清除。
- 模块 throw 不出现 Dashboard boot failed。
- 小组页 completion 模块失败不影响 metrics 和 owner review。

---

## 14. 验收脚本建议

### 14.1 普通自动化

```bash
npm test
```

重点单测：

```bash
npm test -- tests/publicAppBehavior.test.mjs
npm test -- tests/teamWorkCompletionApi.test.mjs
npm test -- tests/readModelRepository.test.mjs
npm test -- tests/serverReadModelGzip.test.mjs
npm test -- tests/realtime.test.mjs
```

### 14.2 手动验收

#### 场景 A：冷启动

1. 停服务。
2. 清理或破坏当前 read-model detail sidecar。
3. BAT 启动。
4. 30 秒内打开：
   - 首页。
   - 小组页。
   - 团队工作完成弹窗。
   - 项目详情弹窗。

通过标准：

- 页面可打开。
- 不出现大面积空白。
- 不出现长时间全页 loading。
- 缺 detail 只局部 pending。

#### 场景 B：运行期 refresh

1. 打开小组页，等待数据出现。
2. 触发自动更新或手动 refresh。
3. 观察两个核心模块。

通过标准：

- 旧内容保留。
- 只显示刷新 chip。
- 新数据回来后替换。
- 失败仍显示旧内容。

#### 场景 C：快速切换

1. 在小组页连续切换 owner/context/year。
2. 观察 URL、标题、内容 scope。

通过标准：

- 晚返回旧响应不覆盖当前 owner。
- 目标无缓存时旧内容保留，显示正在切换。
- 目标缓存命中时立即显示目标缓存。

#### 场景 D：弹窗首次点击

1. 正常进入小组页。
2. 打开 DevTools Network。
3. 首次点击小组 / 成员 / 月份弹窗。

通过标准：

- 不出现 `view=detail` 请求。
- 项目行直接出现。
- 如果 read model 缺片，只出现 `fallback=readModel` 且快速 202。
- 不出现 `fallback=compute`。

#### 场景 E：Codex 修改代码

1. 打开小组页。
2. 修改 public 文件触发 dev reload。
3. 观察页面恢复。

通过标准：

- route/owner/context/year 恢复。
- 旧小组内容先展示。
- 背景刷新。
- 不永久 loading。

---

## 15. Definition of Done

本轮修复完成必须同时满足：

- 冷启动 0～30 秒内核心页面和弹窗可用。
- 小组页已有内容后，任何后台刷新不清空。
- owner/context/year 切换不清空旧内容。
- 当前 scope detail 在点击前 ready。
- 正常弹窗点击不发 detail 请求。
- 异常缺片 detail 请求快速 202。
- UI 点击路径无 `fallback=compute`。
- service restart/dev reload 后恢复当前页面。
- boot error 不残留。
- 大 payload 不 runtime gzip 卡顿。
- 自动化测试覆盖上述场景。

---

## 16. Codex 执行优先级建议

### 第一批 PR：前端不清空 + 刷新软化

范围：

- `public/lib/dashboard-loader.mjs`
- `public/pages/teams.mjs`
- `public/pages/team-work-completion.mjs`
- `public/realtime.js`
- `tests/publicAppBehavior.test.mjs`
- `tests/realtime.test.mjs`

目标：先让用户不再看到“已有页面突然回到大 loading”。

### 第二批 PR：dashboard-session partial ready

范围：

- `src/backend/readModelRepository.mjs`
- `src/backend/server.mjs`
- `src/backend/precomputeTeamDashboards.mjs`
- `tests/readModelRepository.test.mjs`
- `tests/teamWorkCompletionApi.test.mjs`

目标：owner session 不因 detail 缺片整体 preparing。

### 第三批 PR：点击前 detail ready

范围：

- `public/pages/team-work-completion.mjs`
- `public/pages/teams.mjs`
- `public/domain/team-work-completion-store.mjs`
- `tests/teamWorkCompletionModalInteraction.test.mjs`

目标：正常首次弹窗点击零网络、零 compute、项目行直接出现。

### 第四批 PR：dev reload / restart 恢复

范围：

- `public/realtime.js`
- `public/boot.js`
- `public/lib/runtime-flags.mjs`
- `tests/bootGuard.test.mjs`
- `tests/browserSync.test.mjs`
- `tests/runtimeApi.test.mjs`

目标：开发态也像成熟 SaaS，不因 Codex 改代码破坏用户页面。

### 第五批 PR：payload / gzip / read-model 发布治理

范围：

- `src/backend/server.mjs`
- `src/backend/readModelRepository.mjs`
- `src/backend/precomputeTeamDashboards.mjs`
- `tests/serverReadModelGzip.test.mjs`
- `tests/dashboardSessionBudget.test.mjs`

目标：大包拆分、静态 gzip 直出、current 永不拔掉。

---

## 17. 最终一句话

yeswood 的目标不是把 loading 做漂亮，而是让用户觉得系统一直“在手里”：旧数据永远不被后台动作清空，当前交互永远走轻量 read path，新数据准备好后无感替换，失败也保留旧结果并给出局部重试。
