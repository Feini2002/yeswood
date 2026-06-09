# 前端拆分收尾复盘

> 日期：2026-06-09  
> 范围：`public/` 前端 ESM 拆分、拆分后运行时风险、测试与文档收口  
> 当前判断：目录拆分和 P0 漏 import 修复已落地；但 2K 桌面端浏览器走查、数据状态文件归属、OpenSpec archive 和部分架构边界收口仍未完成。当前不建议 archive `split-frontend-monolith`。

## 1. 当前事实

前端大单体已经从单文件入口迁出为 `lib/`、`domain/`、`components/`、`pages/`、`styles/` 分层结构：

- `public/app.js` 已压到约 308 行，低于 OpenSpec 的 800 行上限，主要保留入口编排、事件绑定和导出兼容。
- 样式入口已切到 `public/styles/app.css`，根目录 `public/styles.css` 只做兼容重定向。
- profile、teams、details、overview、rules、developer-docs 等页面逻辑已进入 `public/pages/`。
- 公共 API、格式化、状态、DOM、路由、运行时 flag、视图协调能力已进入 `public/lib/`。
- 复用 UI 已进入 `public/components/`；既有图表与 tooltip 模块仍保留在 `public/dashboard/`。
- 不引入运行时前端 npm 依赖，`public/vendor/` 已移除。

本轮主要修复拆分后最容易漏掉的 ESM 运行时问题：函数体内使用了从单体时代继承下来的隐式全局符号，但拆成模块后没有 import。

## 2. 已修复问题

### 2.1 Profile 看板空态风险

修复文件：

- `public/pages/profile-shared.mjs`
- `public/lib/constants.mjs`
- `public/domain/metrics-display.mjs`

已补齐：

- `DASHBOARD_METRICS_ENDPOINT`
- `OVERVIEW_KPI_METRICS`
- `OWNER_TIER_METRIC_META`
- `metricDefinitionTooltip`
- `displayProjectHardOwner`
- `displayProjectSoftOwner`
- `buildDirectorOverviewModel`
- `PROFILE_SEGMENT_ROWS`
- `PROFILE_SEGMENT_COLUMNS`
- `normalizeDashboardContext`

影响：加盟 / 直营 profile 加载、店型矩阵、KPI drill filter 不再因 `ReferenceError` 误显示为空数据。

### 2.2 Teams 与 drill modal 渲染风险

修复文件：

- `public/pages/teams.mjs`
- `public/components/drill-modal.mjs`
- `public/pages/owner-review.mjs`

已补齐：

- `bindDashboardTooltips`
- `tooltipDataAttr`
- `metricDefinitionTooltip`
- `renderOwnerMonthlyTierBoard`
- `renderLegacyTeamSummaryKpis`
- `openProjectDetailByReference`
- `DETAILS_WORKBENCH_VIEWS`
- `projectWorkbenchRowCells`
- `ownerTierRows`
- `ownerTierMetricKeys`
- `fetchJson`
- `toQuery`
- `hideTooltip`
- `closeProjectDetailModal`
- `closeOwnerReviewMemberModal`
- `ownerReviewModuleVisible`

同时修复了 tier board 中 `</small>` 标签缺失的 HTML typo。

### 2.3 Overview 年度进店结构切换风险

修复文件：

- `public/pages/overview.mjs`

已补齐：

- `ENTRY_STRUCTURE_ENDPOINT`
- `fetchJson`

影响：年度进店结构切换年份时不再依赖未定义符号。

### 2.4 CSS 拆分与测试读取

修复文件：

- `public/styles/app.css`
- `public/styles/components.css`
- `public/styles/pages/*.css`
- `tests/brand-ui.test.mjs`

已完成：

- `app.css` 聚合 tokens、base、components、overview、shared-pages、teams、profile、details。
- `brand-ui` 测试改为递归读取 `app.css` import 链，后续继续拆页面 CSS 不会误报。
- `rules` 与 `developer-docs` 样式当前在 `base.css` 中；`owner-review` 样式当前归入 `pages/teams.css`，这与页面嵌入关系一致。

## 3. 新增防护与覆盖边界

新增 `tests/frontendSplitPolicy.test.mjs` 调用级回归：

- profile store segment matrix 与 overview model 路径会真实执行。
- team tier board 渲染路径会真实执行。
- 继续约束运行时不引入第三方前端依赖。

这些调用级测试专门防止“模块能 import，但页面函数一调用就 `ReferenceError`”的拆分回归。

当前仍未自动覆盖：

- 2K 桌面端真实浏览器布局、悬停、选中、禁用、弹窗层级和控制台错误。
- OpenSpec / README 中声明的完整单向 import 边界。
- 数据状态文件是否应纳入本次前端拆分变更。
- `dashboard/` 作为逻辑层还是 UI primitive 层的长期边界。

## 4. 架构边界复查

三名只读 Agent 复查后，结论是：目录拆分已经有价值，但当前 import 图还不能证明“分层架构完全干净”。这不影响继续执行 2K 浏览器走查，但会影响 OpenSpec archive 的判断。

### 4.1 已经干净的部分

- `public/app.js` 已是薄入口，满足 800 行以内的完成条件。
- 主导航页面已经有 `public/pages/*.mjs` 对应模块。
- CSS 已由 `public/styles/app.css` 聚合。
- 没有引入生产运行时框架、bundler 或第三方前端依赖。

### 4.2 当前与规则不一致的边界

这些问题需要修复，或正式修改 OpenSpec / README，把例外写成被接受的架构决策；否则不应把 `split-frontend-monolith` 归档为架构完成。

| 问题 | 当前事实 | 建议 |
| --- | --- | --- |
| `lib/` 向上依赖 | `public/lib/dashboard-loader.mjs` import 了 `domain/`、`components/`、`pages/`，但 `public/lib/README.md` 写明 `lib/` 不应依赖上层 | 将 `dashboard-loader.mjs` 迁到更高层，例如 app shell / coordinator；或把它从 `lib` 例外化并更新规格 |
| `domain/` 不完全纯 | `public/domain/personnel.mjs` 依赖 `elements`、`components/filter-bar.mjs`；`public/domain/metrics-display.mjs` 依赖 `state`、`router`、`components/filter-bar.mjs`、`dashboard/project-lifecycle.mjs` | 将 DOM / 当前页面 / filter 读取下沉或上移到 page/component 层，让 domain 只保留纯计算 |
| `components/` import `pages/` | `public/components/drill-modal.mjs` import `public/pages/owner-review.mjs` 的关闭函数 | 改为 callback / context 注入，或抽到中立 helper / coordinator |
| page-to-page import 例外未写清 | `direct.mjs`、`franchise.mjs`、`overview.mjs` import `profile-shared.mjs`；`teams.mjs` import `owner-review.mjs` | 明确 `profile-shared.mjs` 是非路由共享 helper；`teams -> owner-review` 若保留，也应在规格中标成 teams 子模块例外 |
| `dashboard/` 边界缺 README | `dashboard/` 被 pages、components、lib、domain 多层引用 | 补 `public/dashboard/README.md` 或把可复用 primitive 下沉到 `components/` / `lib/` |

### 4.3 Archive 判断

按当前 OpenSpec 的单向依赖要求，架构边界仍是 archive blocker。可选路径：

1. **修代码**：先消除上述 import 反向依赖，再 archive。
2. **修规格**：如果这些例外是有意设计，更新 `openspec/changes/split-frontend-monolith/specs/frontend-architecture/spec.md`、目录 README 和本文档，把例外写成正式约束。
3. **分拆 follow-up**：若本轮只想先完成浏览器验收，则保留 change 为 in-progress，在后续任务中收边界。

## 5. 数据与工作树边界

当前 worktree 中 `data/app.sqlite` 与 `data/dashboard-cache.json` 均为 modified：

- `data/app.sqlite` 是二进制 SQLite 数据状态文件。
- `data/dashboard-cache.json` 是兼容缓存快照。

本次前端拆分收口不得默认把它们纳入前端结构变更。提交或 archive 前必须由负责人确认以下三选一：

- 保留本次数据刷新，并在提交说明中明确它不是前端结构变更。
- 拆出为单独数据提交。
- 还原或排除这两个数据状态文件。

同样需要注意：当前 worktree 还有 `.claude/`、`.cursor/`、docs、脚本、测试、public 拆分目录等多处改动；收口前应按变更主题分组，避免把无关变更混入同一个提交。

## 6. 验证证据

已有记录：

```text
node --test：392/392 通过
前端定向组：99/99 通过
public 模块 import 冒烟：42/42 通过
openspec validate split-frontend-monolith：valid
openspec validate --all：1 passed, 0 failed
```

证据边界：

- 上述 Node 测试与 import 冒烟结果来自 2026-06-09 的收口记录；本轮 Agent 复查没有重新跑 Node 测试。
- 本轮重新确认过 OpenSpec 状态：`split-frontend-monolith` 仍为 `in-progress`，53/55 项完成；剩余 7.3 与 7.5。
- `node:sqlite` 会输出 ExperimentalWarning，这是当前使用 Node 内置 SQLite 的技术提示，不是本轮失败。

Archive 前必须刷新：

```powershell
node --test
node --test tests/publicAppBehavior.test.mjs tests/brand-ui.test.mjs tests/homeDirectorMetrics.test.mjs tests/frontendSplitPolicy.test.mjs
openspec.CMD validate split-frontend-monolith
openspec.CMD validate --all
```

若继续保留 `public/**/*.mjs` import 冒烟检查，也应记录实际执行命令、模块数量、通过数量和失败模块列表；不要只写“冒烟通过”。

## 7. 仍需执行：2K 桌面端浏览器走查

### 7.1 执行前原则

本项目所有前端验收只按 2K 桌面端体验执行：

- 视口：`2560 x 1440`
- 浏览器缩放：100%
- 不以移动端、小窗或响应式压缩结果作为验收依据
- 验收时打开控制台，记录 console error 与 failed network request

不要直接前台运行 `npm run dev` 作为验收方式；它是常驻服务命令，没有内建 PID、日志、健康检查和退出边界。也不要无脑前台运行 `scripts/launch-*.ps1` 后让当前任务卡住；这些脚本会启动服务并进入等待循环，适合人工专用终端，不适合作为 Agent 无上限命令。

### 7.2 服务启动安全剧本

推荐验收端口：

- 开发验收：`4200`，用于 `#rules` / `#developer-docs` 等 development-only 页面。
- 内网展示验收：`4300`，用于 snapshot 展示模式；该模式可能隐藏 development-only 页面。

启动前必须做端口边界确认：

```powershell
Get-NetTCPConnection -LocalPort 4200 -State Listen -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 4300 -State Listen -ErrorAction SilentlyContinue
```

如果端口被占用：

- 先确认 PID、命令行和是否属于当前任务。
- 不能确认时，换端口。
- 只有明确命中本次任务启动的 PID，才允许停止。

Agent 安全启动建议使用 `Start-Process` 后立即健康检查，并记录 PID / 端口 / 日志：

```powershell
$env:PORT='4200'
$env:HOST='127.0.0.1'
$env:DASHBOARD_DEV_RELOAD='1'
$logDir='.tmp'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$server = Start-Process -FilePath node -ArgumentList '.\src\backend\server.mjs' -WorkingDirectory . -RedirectStandardOutput "$logDir\frontend-split-2k.out.log" -RedirectStandardError "$logDir\frontend-split-2k.err.log" -PassThru -WindowStyle Hidden
$server.Id
```

健康检查必须在 30 秒内完成：

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:4200/api/health' -UseBasicParsing -TimeoutSec 3
Invoke-WebRequest -Uri 'http://127.0.0.1:4200/api/snapshot' -UseBasicParsing -TimeoutSec 20
```

验收完成或失败后必须关闭本次新启动的服务：

```powershell
Stop-Process -Id <PID> -Force
Get-NetTCPConnection -LocalPort 4200 -State Listen -ErrorAction SilentlyContinue
```

如果健康检查超时：

- 读取 `.tmp/frontend-split-2k.err.log` 和 `.tmp/frontend-split-2k.out.log`。
- 停止本次启动的 PID。
- 记录失败原因，不继续声称页面已验证。

### 7.3 路由与页面清单

按以下顺序验收，并记录 pass/fail、截图路径、console/network 异常：

| 路由 | 验收重点 |
| --- | --- |
| `/` 或 `#overview` | KPI、阶段跑道、风险队列、区域矩阵、年度进店结构；年份切换不报错 |
| `#franchise` | profile KPI、店型矩阵、风险队列、负责人矩阵、KPI drill |
| `#direct` | profile KPI、店型矩阵、风险队列、负责人矩阵、KPI drill |
| `#teams` | 负责人切换、团队 KPI、tier board、团队数据健康、负责人复盘入口 |
| `#teams?owner=<负责人>&dashboardContext=direct` | query 参数可恢复负责人和上下文；页面不退回空态 |
| `#owner-review?ownerPressurePerson=<姓名>` | legacy hash 应进入 teams 内嵌 owner-review，不出现独立 owner-review 导航页 |
| `#details` | 筛选、暂停项切换、表格视图、详情弹窗、Deadline 例外视图 |
| `#details?search=<关键词>&metric=openDelayed` | drill 参数可恢复筛选，列表和计数一致 |
| 从 KPI / tier board 打开 drill modal | modal 可打开、关闭、跳转 details；无控制台错误 |
| `#rules` | development 模式下规则页可见；Deadline 规则说明弹窗可打开关闭 |
| `#developer-docs` | development 模式下开发文档页可见；intranet / 非开发模式应隐藏 |

### 7.4 交互与视觉清单

每个相关页面都要看：

- loading / error / empty / normal 数据态是否区分清楚。
- hover、选中、禁用、展开/折叠、弹窗关闭是否有反馈。
- 卡片、表格、矩阵和工具栏在 2K 视口下没有文字重叠、按钮挤压或横向断裂。
- drill modal、项目详情弹窗、owner-review 成员弹窗层级正确，关闭后页面状态不丢。
- 同步按钮、分析 Agent 按钮和错误提示不出现无法恢复的 pending 状态。

### 7.5 验收报告模板

2K 走查完成后，在任务记录或后续复盘中补充：

```text
验收时间：
验收人：
浏览器 / 版本：
视口与缩放：
URL：
服务 PID：
端口：
启动命令：
日志：
健康检查：
/api/snapshot 记录数与 syncedAt：
通过路由：
失败路由：
console error：
failed network request：
截图 / 录屏路径：
是否关闭服务：
残留风险：
```

## 8. 后续维护建议

- 若继续拆 `pages/`，优先增加“函数体调用级”测试，而不是只做 import 冒烟。
- 不要继续把编排模块放进 `lib/`；`lib` 应保持低层工具定位。
- 避免从普通页面反向 import 另一个普通页面；需要共享 markup/helper 时放到中立模块。
- `public/dashboard/` 当前仍被前端和部分指标逻辑引用，不要在本次任务里继续物理搬迁；但应补边界说明。
- `owner-review.mjs`、`teams.mjs`、`profile-shared.mjs`、`styles/pages/teams.css`、`styles/pages/profile.css` 体量仍较大；后续不要为了行数继续盲拆，应先用调用级测试锁住行为。
- `data/app.sqlite` 与 `data/dashboard-cache.json` 是数据状态文件，提交前必须确认归属。

## 9. 收口状态

OpenSpec 当前状态：

- `split-frontend-monolith` 仍为 `in-progress`。
- 代码目录拆分、CSS 拆分、测试入口、P0 漏 import 修复已经落地。
- OpenSpec validate 当前记录为通过。
- 2K 桌面端浏览器走查未完成。
- 数据状态文件归属未确认。
- 架构边界与 OpenSpec 单向依赖规则仍有偏差。
- 变更尚未 archive。

建议下一步：

1. 先决定架构边界偏差是修代码、修规格，还是拆成 follow-up。
2. 解决 `data/app.sqlite` 与 `data/dashboard-cache.json` 的归属。
3. 按第 7 节执行 2K 桌面端浏览器走查。
4. 刷新 `node --test`、前端定向组、OpenSpec validate 证据。
5. 上述全部完成后，再执行 archive。

## 10. Cursor 执行切片

这一节是给后续 Cursor 执行用的细粒度任务单。每次只做一个切片，不要把架构修复、数据归属、浏览器点验和 archive 混在同一个提交里。

### 10.1 总执行原则

每个切片开始前先做：

```powershell
git status --short
openspec.CMD list --json
```

每个切片结束前必须写清楚：

- 本切片改了哪些文件。
- 本切片没有改哪些文件，尤其是 `data/app.sqlite`、`data/dashboard-cache.json`。
- 跑了哪些命令，退出码是什么。
- 哪些检查没有跑，原因是什么。
- 是否还有服务进程或端口残留。

禁止事项：

- 不要默认提交或还原 `data/app.sqlite`、`data/dashboard-cache.json`。
- 不要用 `git reset --hard`、`git checkout --` 或批量删除来“清理”工作树。
- 不要前台运行会常驻的 `npm run dev`、watch、浏览器或服务命令。
- 不要把 OpenSpec task 勾成完成，除非已经有对应证据。
- 不要顺手改后端 DingTalk 字段语义、表单口径或数据清洗逻辑。
- 不要为了通过测试放宽 OpenSpec / README 的架构规则；如需改变规则，必须把“为什么接受例外”写进规格。

### 10.2 切片 A：确认数据与工作树边界

目标：先把“哪些文件属于前端拆分，哪些属于数据状态或工具链变更”说清楚。

允许改动：

- `docs/handbook/frontend-split-review.md`
- 必要时更新 `docs/STATUS.md` 的当前状态说明

不要改动：

- `data/app.sqlite`
- `data/dashboard-cache.json`
- `public/**/*.mjs`
- `tests/**/*.mjs`

步骤：

1. 运行 `git status --short`。
2. 运行 `git status --short -- data/app.sqlite data/dashboard-cache.json`。
3. 运行 `git diff --stat -- data/app.sqlite data/dashboard-cache.json`，只看体量，不输出业务明细。
4. 在回复中把变更分成四类：前端结构、文档/OpenSpec、数据状态、工具/命令配置。
5. 如果数据文件仍 dirty，停止 archive 流程，只记录“需要负责人决定归属”。

验收证据：

- 输出包含 `data/app.sqlite` 与 `data/dashboard-cache.json` 的当前状态。
- 输出包含“是否允许纳入本次前端拆分提交”的明确判断。

停止条件：

- 如果有人要求直接还原数据文件，但没有明确说明这是安全操作，停止并询问。
- 如果发现数据文件里需要查看业务明细才能判断，停止并要求负责人确认，避免泄露敏感内容。

### 10.3 切片 B：只读架构边界复查

目标：不改代码，先复查当前 import 图是否仍违反 OpenSpec。

允许改动：

- 无；只读

建议检查命令：

```powershell
rg -n "from '../pages|from './owner-review|from './profile-shared|from '../components|from '../domain|from '../lib|from '../dashboard|from './lib/dashboard-loader'" public/lib public/domain public/components public/pages public/app.js
```

对照规则：

- `lib/` 不应 import `domain/`、`components/`、`pages/`。
- `domain/` 不应 import `components/`、`pages/`，也不应直接操作 DOM。
- `components/` 不应 import `pages/`。
- `pages/` 之间只允许已经写清楚的非路由 helper 例外。
- `dashboard/` 如果继续被多层引用，必须补边界说明。

输出格式：

```text
架构边界复查：
- lib 向上依赖：
- domain UI/DOM 依赖：
- components -> pages：
- pages -> pages：
- dashboard 边界：
- 建议路径：修代码 / 修规格 / 拆 follow-up
```

停止条件：

- 如果复查发现与本文第 4 节不一致，先更新本文档证据，不要直接开始重构。

### 10.4 切片 C：选择架构路径

目标：在修代码、修规格、拆 follow-up 之间做明确选择。

推荐决策表：

| 情况 | 选项 |
| --- | --- |
| 现有 import 只是搬迁遗留，没有业务必要 | 修代码 |
| 现有 import 是有意设计，例如 `profile-shared.mjs` 是非路由 helper | 修规格，并同步 README |
| 修复会碰大量页面行为，风险超过本轮收口 | 拆 follow-up，当前 change 不 archive |

必须写出的决定：

- `dashboard-loader.mjs` 是否继续属于 `lib/`。
- `profile-shared.mjs` 是否被正式定义为非路由共享 helper。
- `owner-review.mjs` 是否被正式定义为 teams 子模块例外。
- `dashboard/` 是 page helper、component primitive，还是待迁移遗留层。
- 是否需要新增 import-boundary 自动化测试。

允许改动：

- 如果选择修规格：`openspec/changes/split-frontend-monolith/specs/frontend-architecture/spec.md`
- 如果选择修规格：`public/lib/README.md`、`public/domain/README.md`、`public/components/README.md`、`public/pages/README.md`
- 如果只是记录决定：本文档

验收命令：

```powershell
openspec.CMD validate split-frontend-monolith
openspec.CMD validate --all
```

停止条件：

- 如果没有明确选择，不要进入代码重构。

### 10.5 切片 D：架构代码修复（仅在选择“修代码”后执行）

目标：把实际 import 图修到符合 OpenSpec，而不改变业务行为。

执行顺序必须是：

1. 先新增 import-boundary 测试，确认它失败，失败列表要对应第 4 节问题。
2. 一次只修一类边界。
3. 每修一类，跑一次针对性测试。
4. 全部修完后再跑前端定向组。

建议子任务：

| 子任务 | 目标 | 验收 |
| --- | --- | --- |
| D1 | 将 `dashboard-loader.mjs` 从 `lib/` 移到 app shell / coordinator 层，或拆出低层纯函数 | `lib/` 不再 import 上层 |
| D2 | 将 `personnel.mjs` 中 DOM select 渲染迁到 component/page 层 | `domain/personnel.mjs` 不再 import `components/` 或 `elements` |
| D3 | 将 `metrics-display.mjs` 的 active filter 合并逻辑迁到 drill modal 或调用方 | `domain/metrics-display.mjs` 不再 import `components/filter-bar.mjs` |
| D4 | 将 `drill-modal.mjs` 对 `owner-review.mjs` 的关闭调用改成 callback/context 注入 | `components/` 不再 import `pages/` |
| D5 | 明确或消除 `pages -> pages` 例外 | README / OpenSpec 与代码一致 |
| D6 | 补 `public/dashboard/README.md` 或迁移 dashboard primitive | `dashboard/` 边界清楚 |

每个子任务结束必须跑：

```powershell
node --test tests/frontendSplitPolicy.test.mjs
node --test tests/publicAppBehavior.test.mjs tests/brand-ui.test.mjs tests/homeDirectorMetrics.test.mjs
```

停止条件：

- 如果需要改业务口径、后端 API、数据字段或 DingTalk 逻辑，停止并另开 OpenSpec change。
- 如果一个子任务需要同时改 5 个以上业务页面，停止并拆更小任务。

### 10.6 切片 E：刷新测试证据

目标：把本文第 6 节的历史验证记录刷新成当前证据。

先跑前端定向组：

```powershell
node --test tests/publicAppBehavior.test.mjs tests/brand-ui.test.mjs tests/homeDirectorMetrics.test.mjs tests/frontendSplitPolicy.test.mjs
```

再跑全量：

```powershell
node --test
```

最后跑 OpenSpec：

```powershell
openspec.CMD validate split-frontend-monolith
openspec.CMD validate --all
```

记录格式：

```text
验证时间：
命令：
退出码：
通过数量：
失败数量：
警告：
未执行项：
```

停止条件：

- 任一测试失败，不要继续 2K 验收或 archive。
- 如果失败来自已知数据状态文件变化，先回到切片 A。

### 10.7 切片 F：2K 浏览器走查

目标：完成 OpenSpec 7.3。

先决条件：

- 切片 A 已明确数据文件归属。
- 切片 C 已明确架构路径。
- 切片 E 的测试证据是当前最新。

执行步骤：

1. 按第 7.2 节确认端口。
2. 后台启动服务，记录 PID、端口、日志。
3. 30 秒内完成 `/api/health` 和 `/api/snapshot` 健康检查。
4. 用 2560 x 1440、100% zoom 打开浏览器。
5. 按第 7.3 节逐路由检查。
6. 按第 7.4 节逐交互检查。
7. 保存截图或录屏路径。
8. 关闭本次启动 PID。
9. 确认端口释放。
10. 填写第 7.5 节验收报告模板。

停止条件：

- 健康检查失败。
- 页面有未解释的 console error。
- 服务无法确认 PID 或端口归属。
- 任何页面出现 2K 视口下明显重叠、空白、弹窗无法关闭或 drill 参数丢失。

### 10.8 切片 G：OpenSpec archive 门禁

目标：只在所有证据齐全后归档。

归档前逐项确认：

- [ ] OpenSpec 7.3 已完成，有 2K 验收报告。
- [ ] OpenSpec 7.4 当前仍 validate 通过。
- [ ] 架构边界问题已经修复，或规格/README 已明确例外。
- [ ] `data/app.sqlite` 与 `data/dashboard-cache.json` 归属已确认。
- [ ] `node --test` 当前通过。
- [ ] 前端定向组当前通过。
- [ ] 没有本次新启动的服务进程残留。
- [ ] `docs/STATUS.md` 与本文档状态一致。

满足全部条件后，才执行 archive。Archive 后重新跑：

```powershell
openspec.CMD validate --all
git status --short
```

停止条件：

- 任一 checkbox 无证据，不 archive。

### 10.9 给 Cursor 的推荐单轮提示

可以把下面这段作为 Cursor 每一轮的开头：

```text
本轮只做 docs/handbook/frontend-split-review.md 第 10 节指定的一个切片：<填写切片名>。
不要改其他切片，不要启动常驻服务，不要改 data/app.sqlite / data/dashboard-cache.json。
先列出将读取的文件和将运行的命令；执行后给出证据、退出码、未完成项和停止条件判断。
如果发现需要跨切片处理，停止并说明，不要自行扩大范围。
```
