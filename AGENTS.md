# 项目 Codex 规则

## 前端范围

- 所有前端改动都按 2K 分辨率桌面端体验、布局和交互进行设计、实现与验证；不考虑移动端，也不考虑浏览器窗口缩小后的页面适配。
- 前端模块改动不能只满足最低可见字段；列表、分组、负载、状态类界面要主动多评估一步，包括是否需要折叠/展开、空/有数据区分、选中/悬停/禁用状态、可点击反馈和信息密度控制。不要求每次机械添加这些设计，但适合时应直接纳入实现，不适合时要说明原因。

## 路由与数据加载解耦防复发规则

- `showPage` 只负责页面外壳切换、导航高亮、hash 参数应用和必要的 `pageChanged` 首次进入加载；同一页面内 query/hash 变化不得触发页面级数据加载或 `scrollTo(0, 0)`。
- `hashchange` 入口必须只调用 `showPage(currentPageId())` 这类页面外壳同步逻辑；不得在该入口直接调用 `refresh`、`loadDashboard`、owner loader 或任何重数据接口。
- 首屏初始化必须用 `showPage(currentPageId(), { skipPageDataLoad: true })`，`loadDashboard` 是唯一首屏与全局刷新编排入口，避免 `showPage` 与 `loadDashboard` 同时请求 teams/profile 数据。
- 普通页面切换、owner/context/year 切换默认使用 cache-first 或局部显式 loader；只有用户点击刷新、同步、分析小组、自动更新等明确刷新动作才能传递 `forceRefresh: true`。
- owner/context/year 等切换目标未命中缓存时，必须保留当前可见内容并后台请求新数据；不得先清空运营概览、团队完成度或负责人负载再显示大面积 loading。只有当前页面没有任何可用旧数据时，才允许显示整块 loading。
- teams/profile 这类重数据页面新增 loader 时，必须同时具备 in-flight 去重、缓存命中快返、跨 context/owner/year 的旧请求防回写机制；批量请求要用 generation/requestId/AbortController 等方式阻断过期响应污染当前视图。
- 修改 `router.mjs`、`dashboard-loader.mjs`、`app.js`、`pages/teams.mjs`、`pages/profile-shared.mjs` 的数据加载边界时，必须同步更新并运行 `tests/publicAppBehavior.test.mjs`；若职责边界或守则变更，也要同步 `tests/frontendSplitPolicy.test.mjs`。
- 防复发验收至少覆盖：首屏 teams 无 `showPage + loadDashboard` 双加载、同页 hash/query 切换不触发页面级 reload、profile 返回不重复请求、teams context 快速切换旧响应不回写、缓存命中不刷新、显式 `forceRefresh` 仍会刷新。

## 看板加载性能防复发规则

- `loadCoreDashboard` 只拉 `snapshot`、一次无筛选 `/api/metrics`、`department` profile；首屏不得默认并行第二次 `/api/metrics`，也不得默认拉全量 `/api/projects`。
- 项目目录统一走 `public/domain/project-catalog.mjs`：`view=summary` 写入 `state.allProjects`，并与 `projectsCatalogSignature` 绑定 snapshot；钉钉同步、自动更新或 snapshot 签名变化必须调用 `invalidateProjectCaches`。
- 明细页搜索/筛选、同页 hash 参数同步只能走 `softRefresh` 本地过滤；禁止把这些交互改回 `refresh()` / `loadDashboard({ forceRefresh: true })` 全量重拉。
- KPI / 小组下钻弹窗必须走 `resolveDrillProjects`：`fields=ids` + 本地目录拼装；禁止恢复 `fetchJson('/api/projects' + toQuery(filters))` 全量列表路径。
- 小组页 `loadTeamPageModules` 必须先完成 team metrics / work completion / responsibility 三组接口，再后台预载 summary 项目目录；禁止把 catalog 与小组重接口放在同一 `Promise.all` 里抢占首屏。
- 小组负责人切换必须先 `loadTeamWorkCompletion`，并保留上一份完成度作切换占位；后台预载其它负责人 completion 时不得抢占当前切换请求。
- 后端 `/api/team-work-completion`、`/api/team-responsibility-review` 必须走 snapshot 签名缓存；JSON gzip 不得使用同步 `gzipSync` 阻塞事件循环。
- 单项详情允许 `fetchProjectDetail` 懒加载 `view=full`；列表下钻不得因此回退成全量 projects 请求。
- 后端 `/api/projects` 默认 `view=summary`；JSON 响应大于 1KB 时应 gzip；`fields=ids` 专供下钻，不得把完整 `rawFields` 当作列表默认返回。
- 修改 `dashboard-loader.mjs`、`project-catalog.mjs`、`drill-modal.mjs`、`project-workbench.mjs`、`server.mjs` 的 projects 路由或加载边界时，必须同步更新并运行 `tests/frontendLoadPerformancePolicy.test.mjs`、`tests/projectCatalog.test.mjs`、`tests/publicAppBehavior.test.mjs`。

## 临时后端边界

- 后端连接的钉钉数据由同事维护。后续不要默认深入调整表单逻辑、字段含义或录入值校验。
- 如果前端看板表现暴露出源数据逻辑可疑，可以主动指出质疑并和用户讨论，但不要默认绕过去或直接改后端数据逻辑。

## 规则立法层次与同步约定

硬装 Deadline 等可执行规则分三层维护，不要求在 README、公司背景、AGENTS 或前端 HTML 里复制完整规则正文：

| 层级 | 权威位置 | 角色 |
| --- | --- | --- |
| 可执行规则 | `src/backend/hardDecorationDeadlineRules.mjs`、`data/rules/china-workday-calendar-*.json` | 矩阵、工作日、兜底逻辑以这里为准 |
| 人类可读规则 | `docs/rules/operational-rulebook.md` | 业务意图、边界、待定项；链接代码与数据权威 |
| 运营展示 | 前端规则一览页（`#rules`） | 摘要、状态、关键口径；不手写完整矩阵副本 |

规则口径、Deadline、提醒节点、延期判定或阶段判定变更时，必须同步检查：

- 后端规则常量与日历数据（`hardDecorationDeadlineRules.mjs`、`data/rules/`）
- `docs/rules/operational-rulebook.md`
- 前端规则一览页的摘要与状态展示
- `tests/hardDecorationDeadlineRules.test.mjs`（矩阵与计算）
- `tests/rulesDocs.test.mjs`（规则正文章节、链接、前端入口）
- `tests/brand-ui.test.mjs`、`tests/publicAppBehavior.test.mjs`（规则页 DOM 与 Deadline 行为，若展示结构变化）

补充约束：

- 硬装 Deadline 的 `Y + N` 统一按中国工作日计算。
- 钉钉表单已填写延期情况时优先采用表单；表单为空时才用系统 Deadline 兜底。提醒仍按后台 Deadline 规则生成。
- 平面方案最终延期状态和实际启动顺延后的效率 KPI 必须分开记录，不得互相覆盖。
- 规则仍处讨论态时，先记入规则文档待定区，不要写成已生效逻辑。
- 前端展示只同步已明确的运营口径；未确认公式、天数和责任边界标为待定。

## 命令执行与卡住防护

- 所有普通命令默认设置 30 秒超时；确需更长时间的测试或构建，必须先说明原因，并设置明确上限。
- 前端开发验证优先复用用户已打开的 Chrome 与已有本地服务，特别是 `4200` 端口；默认通过 Chrome 插件接管当前页面进行查看、刷新、交互和截图验收，不要为了“看一眼效果”重复启动新的开发服务或新的浏览器实例。
- 硬规则：前端视觉验收只能查看用户已经打开的 Chrome 当前页面；不得为了验收打开新的 Chrome、创建新标签页、启动 Playwright/Chromium 新页面或导航到额外页面。Chrome 插件无法接管用户当前页面时，必须直接说明无法接管，并改由用户现场截图/反馈作为视觉验收依据，不得绕路新开页面。
- 浏览器工具禁用动作：前端视觉验收不得调用任何会创建新 target/page/tab/window/browser context 的动作，包括但不限于 DevTools `new_page`、新建标签页、启动 Chromium/Chrome、打开 `about:blank` 后再跳转、对非用户当前页执行 `goto`。如果工具只提供“新建/打开/导航”能力而不能确认接管用户当前页，必须停止使用该工具。
- Chrome 接管前必须先确认目标边界：只能附着到用户已经打开且当前正在查看的项目页面；若只能看到空白页、扩展页、非项目页、历史残留 target，或无法判断是否为用户当前页，都视为接管失败。接管失败不得通过新开页面、切换 URL、另启浏览器或 Playwright 绕过。
- 如果用户已经明确说明浏览器和终端服务在运行，先用 Chrome 插件检查当前标签页、URL、页面状态和控制台；只有在无法连接现有 Chrome、当前页面不属于本项目、端口无服务响应，或用户明确要求重新启动时，才考虑启动新服务。
- 如果用户明确表示自己正在或已经通过 Chrome 完成视觉监视、刷新查看、点击和交互测试，则默认将用户验证视为视觉与交互验收结果；Codex 不再重复执行同类浏览器验收，除非用户要求协助复核、现象异常、改动高风险，或需要定位控制台/网络/DOM 细节。
- 用户已完成视觉/交互验收时，Codex 的验证重点应转向互补项：相关自动化测试、静态检查、代码影响范围、数据/状态边界和残留风险说明；最终回复应明确哪些部分由用户现场验收覆盖，哪些部分由 Codex 补充验证。
- 复用已有服务验收时，最终回复应写明“复用用户已有服务/浏览器”，给出访问地址或当前页面地址、验证方式与结果；如果未能接管当前页，也必须写明“未进行浏览器接管，采用用户现场反馈/截图作为视觉验收依据”。因为不是本次新启动的进程，不需要也不应尝试关闭用户的服务。
- 不要以前台方式运行会常驻的命令，例如开发服务器、watch、监听进程。此类命令必须后台启动，并立即用端口、健康接口或页面访问验证是否成功。
- 如果命令超过 30 秒没有完成或没有新输出，视为可能卡住；需要主动停止等待、检查进程/端口/日志，并向用户说明当前状态。
- 启动本地服务时，必须遵循：后台启动 -> 健康检查 -> 浏览器或接口验收。没有验收结果，不得声称服务已启动或功能已验证。
- 凡是涉及启动服务、watch、监听、浏览器、后台 worker 或任何可能常驻的进程，都视为高风险操作，必须先具备超时熔断方案；禁止“先跑起来再说”。
- 启动前必须确认端口占用与目标进程边界：优先复用已确认属于本任务的服务；需要停止旧进程时，只能停止明确命中的 PID，不要批量杀同名进程。
- 后台启动必须记录 PID、端口、日志路径和启动命令来源；日志应写入项目内临时目录或输出目录，便于卡住时排查。
- 健康检查必须设置明确上限，默认 30 秒内完成；检查方式优先使用 `/api/snapshot`、健康接口、端口探测或浏览器快照。超时未通过时，立即读取日志、报告失败，并停止本次新启动的后台进程。
- 如果用户没有明确要求服务持续运行，验收完成后应关闭本次新启动的临时服务；如果需要保留运行，必须在回复中写明 URL、PID、用途和关闭方式。
- 最终回复不得只说“服务已启动”或“页面已验证”；必须同时给出健康检查结果、访问地址、是否保留进程，以及是否有残留风险。
