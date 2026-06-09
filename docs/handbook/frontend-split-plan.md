# 前端大单体拆分方案

> 状态：主体已完成（2026-06-09）；§7.3 人工点验与 per-page CSS 细拆为后续项  
> 范围：`public/app.js`、`public/styles.css`、`tests/publicAppBehavior.test.mjs`  
> 边界：不拆后端；不引入 React/Vue/Svelte；不新增 runtime npm 依赖

## 文档结构速览

| 章节 | 内容 | 产出 |
| --- | --- | --- |
| 1. 背景 | `app.js` / `styles.css` 体量与已有拆分状态 | 拆分必要性 |
| 2. 痛点 | 定位、协作、回归、测试 harness 风险 | 拆分优先级依据 |
| 3. 目标与非目标 | 入口变薄、按层拆分、零行为回归、零 runtime 依赖 | 本阶段边界 |
| 4. 目标架构 | `lib/`、`domain/`、`components/`、`pages/`、`styles/` | 目录与依赖规则 |
| 5. 切分映射 | `app.js` 行号区间到目标模块 | 迁移参考 |
| 6. 样式策略 | 与 JS 页面边界对齐，`styles/app.css` 聚合 | CSS 拆分方式 |
| 7. 测试策略 | 新增 `test-harness.mjs`，每 Phase 必跑测试与人工点验 | 回归保护 |
| 8. 执行计划 | Phase 0-5 渐进迁移，Phase 6 可选 dev 工具 | 落地顺序 |
| 9-13 | 风险、完成定义、依赖策略、事实校准、参考文档 | 收尾标准 |

---

## 1. 背景

前端已经从 mock 原型演进为多页面运营看板，覆盖总览、加盟、直营、小组、项目详情、规则等视图，并已部分拆出 `public/dashboard/*.mjs`，例如图表、tooltip、年度进店结构等。

但主体逻辑仍集中在两个大单体文件中：

| 文件 | 约行数 | 职责 |
| --- | ---: | --- |
| `public/app.js` | ~10,750 | 状态、路由、API、筛选、页面渲染、事件绑定、初始化 |
| `public/styles.css` | ~10,650 | 全部页面样式 |
| `public/dashboard/*.mjs` | ~2,000 | 已拆出的图表与局部模块（约 10 个文件） |

本方案目标是在不更换前端框架、不强制引入构建工具的前提下，用原生 ES Module 完成大单体拆分，为 P2「项目运营工作台」的本地编辑、复杂表单和持续迭代降低维护成本。

---

## 2. 痛点（拆分必要性）

### 2.1 开发与协作

- **定位成本高**：改小组页、详情页或总览页，都要在一万行级别的 `app.js` 中搜索；`render*` 函数数量多，页面边界不清晰。
- **合并冲突风险高**：所有前端功能共用一个入口文件，两人并行改前端时很容易冲突。
- **新人上手慢**：缺少「总览在哪、小组在哪、详情在哪」的目录地图，只能线性阅读巨型文件。

### 2.2 质量与回归

- **影响面不清晰**：项目阶段、提醒、负责人、风险队列等逻辑交织在一起，局部修改容易影响多处 UI。
- **测试 harness 脆弱**：`tests/publicAppBehavior.test.mjs` 通过 `vm` 读取并拼接 `app.js` 源码做行为断言；文件越大，测试加载与维护成本越高。
- **缺少模块边界**：单页、单组件、纯领域逻辑难以独立测试，也难以在代码评审中判断修改范围。

### 2.3 与路线图的关系

`docs/STATUS.md` 中的 P2「项目运营工作台」会带来：

- 更多页面交互与本地编辑入口；
- 更多写入 API 与表单；
- 项目详情、差异确认、负责人复盘等更复杂的 UI。

如果继续把这些能力堆进 `app.js`，P2 启动成本会显著升高。更稳妥的顺序是：**先拆结构，再加功能**。

### 2.4 本阶段暂不处理

- **运行时性能**：内网看板、约 500 条数据，单文件加载目前不是主要瓶颈。
- **图表库 / 前端框架**：现有简单图表、卡片、表格仍适合手写；少依赖策略保持不变。
- **移动端适配**：项目规则明确按 2K 桌面端设计和验证，不纳入本方案。

---

## 3. 目标与非目标

### 3.1 本阶段要达成

1. **`app.js` 变薄为入口层**：目标控制在 **≤ 800 行**，只负责初始化、路由切换、全局事件委托和 page 模块编排。
2. **按页面与领域拆模块**：业务页面进入 `pages/`，纯判断进入 `domain/`，复用 UI 进入 `components/`，通用工具进入 `lib/`。
3. **公共能力有明确归属**：API、格式化、DOM 工具、共享 state、筛选与路由不再散落在页面渲染逻辑中。
4. **样式按层拆分**：`styles.css` 拆为多文件维护，由 `styles/app.css` 统一聚合。
5. **零行为回归**：拆分前后页面表现一致；关键测试全绿；关键页面人工点验通过。
6. **保持零 runtime npm 依赖**：继续使用原生 ESM + 静态资源，不改变部署方式。

### 3.2 明确不做

- 不引入 React / Vue / Svelte。
- 不为了拆分而引入 Webpack / Vite；Vite 只作为可选 dev 工具讨论。
- 不重写 UI，不调整现有视觉风格。
- 不借机大改业务口径；只允许「搬家」级别的必要重构。
- 不展开 P2 本地编辑表单；只在 `components/` 或 `pages/details.mjs` 预留合理落点。
- 不拆分后端，不调整钉钉数据表单逻辑。

### 3.3 拆分原则

- **先建安全网，再搬代码**：先让测试 harness 具备稳定入口，再逐步迁移。
- **以函数职责为准，行号只作参考**：行号会变化，最终迁移依据函数名和调用关系。
- **一次只迁一条线**：每个 Phase 都应可独立合并、可回滚、可验收。
- **只做结构拆分，不混入新功能**：避免「拆分 + 新需求」叠加导致回归难定位。
- **保持单向依赖**：高层可以依赖低层，低层不能反向 import 高层。

---

## 4. 目标架构

### 4.1 目录结构

```text
public/
  app.js                      # 入口：init、bindEvents、showPage、renderAll 编排
  index.html                  # 页面入口；目标改为引入 /styles/app.css
  realtime.js                 # 已有：开发热更新

  lib/
    api.mjs                   # fetchJson、API endpoint 常量
    format.mjs                # escapeHtml、formatDate、formatDateTime、displayOrDash
    state.mjs                 # createAppState()、共享 state 与 reset 辅助
    dom.mjs                   # elements 注册、bindDashboardTooltips 等 DOM 工具
    router.mjs                # parsePageHash、showPage、hash 参数、navigateTo*
    dashboard-loader.mjs      # loadDashboard、renderAll 编排，从 app.js 抽出

  domain/
    project-workflow.mjs      # 阶段、节点、软硬装进度、暂停、闭环等领域判断
    project-reminders.mjs     # Deadline、关键日期、提醒栈、字段缺口
    project-display.mjs       # 负责人/团队/设计师展示、assignment gap
    personnel.mjs             # personnelArchitecture 读取与人员解析
    metrics-display.mjs       # KPI 格式化、tier、drill filter 构建

  components/
    filter-bar.mjs            # 筛选条、enhanceProjectFilters、filter select 交互
    drill-modal.mjs           # drill-down 弹窗与 navigateToDetailsDrill
    project-workbench.mjs     # 详情/钻取表格行、列头、排序、view tabs
    project-detail-modal.mjs  # 项目详情弹窗
    sync-controls.mjs         # 同步按钮、分析 Agent 按钮、状态文案

  pages/
    overview.mjs              # 总览页 render + load 辅助
    franchise.mjs             # 加盟看板（薄封装，复用 profile-shared）
    direct.mjs                # 直营看板（薄封装，复用 profile-shared）
    profile-shared.mjs        # 加盟/直营共用：profile 模型、渲染、load
    teams.mjs                 # 小组看板 + team metrics；编排 owner-review 子模块
    owner-review.mjs          # 负责人复盘子模块（嵌入 #teams，非独立导航页）
    details.mjs               # 项目情况列表/工作台
    rules.mjs                 # 规则页（development-only）
    developer-docs.mjs        # 开发文档页（development-only）

  dashboard/                  # 已有模块，保持并归类为 components 层
    chart-bar.mjs
    chart-column.mjs
    tooltip.mjs
    empty-state.mjs
    insight-card.mjs
    home-director-metrics.mjs
    annual-entry-structure.mjs
    project-lifecycle.mjs
    province-display.mjs

  styles/
    tokens.css                # 颜色、间距、字号、阴影变量
    base.css                  # reset、app-shell、sidebar、通用 typography
    components.css            # filter-bar、modal、tooltip、empty-state、insight-card
    pages/
      overview.css
      profile.css             # franchise + direct 共用
      teams.css
      owner-review.css
      details.css
      rules.css
    app.css                   # @import 汇总（或 build 时合并）
```

### 4.2 依赖方向

```text
app.js      → pages / components / lib
pages       → components / domain / lib / dashboard
components  → domain / lib
domain      → lib
lib         → 无上层依赖
```

必须遵守：

- `pages` 之间禁止互相 import；跨页面复用逻辑应下沉到 `components/`、`domain/`、`lib/` 或同层 helper（如 `profile-shared.mjs`）。
- `owner-review.mjs` 由 `teams.mjs` import，不算独立导航页；legacy hash `#owner-review` 继续重定向到 `#teams`。
- `public/domain/` 是**前端展示侧**判断（阶段文案、提醒展示、表格列），不与 `src/backend/` 合并；口径以后端与契约文档为准。
- `domain` 禁止 import `pages` / `components`，也不直接读取 `document`。
- `lib` 禁止 import 上层模块。
- `dashboard/` 已拆出的模块不回迁，也不在本阶段物理搬到 `components/dashboard/`；页面或组件继续按需 import。

### 4.3 模块对外约定

每个 `pages/*.mjs` 建议按需导出以下函数：

```javascript
export function mount(ctx) {}      // 首次进入页面时绑定 DOM（可选）
export async function load(ctx) {} // 拉取该页所需 API（可选）
export function render(ctx) {}     // 根据 state 重绘
export function bindEvents(ctx) {} // 页内专属事件（可选，优先全局委托）
```

`ctx`（页面上下文）建议包含：

```javascript
{
  state,           // 共享状态
  elements,        // DOM 引用
  fetchJson,       // API
  navigate,        // 路由/钻取
  renderAll,       // 全局重绘回调（逐步减少直接依赖）
}
```

### 4.4 DOM 与事件归属

`lib/dom.mjs` 不应变成新的大杂烩。建议只放稳定的外壳级 DOM 能力：

- app shell、sidebar、全局 loading / toast、development-only 入口等跨页面元素；
- 通用事件辅助，例如 tooltip 绑定、委托工具、元素安全读取；
- 不随业务页增长而频繁变化的基础 DOM 引用。

页面内部元素不集中塞进 `elements`。迁移某个 `pages/*.mjs` 时，应把该页 `querySelector`、局部 DOM 缓存和页内 `bindEvents(ctx)` 一起迁到该页；组件内部元素则放在对应 `components/*.mjs` 内部。

`app.js` 中的 `bindEvents` 约 90 行，绑定点较多。Phase 3 先整理事件清单，按三类处理：

| 事件类型 | 归属 |
| --- | --- |
| 全局导航、hash、同步、development-only 入口 | `app.js` 或 shell 级组件 |
| 筛选、drill、弹窗、同步控件等可复用交互 | `components/*.mjs` |
| 某个页面独有的 tab、按钮、局部筛选 | 对应 `pages/*.mjs` 的 `bindEvents(ctx)` |

---

## 5. 现状到目标映射（`app.js` 切分参考）

> 行号为快照参考，迁移时以函数名和职责为准。

| 行号区间（约） | 函数群 | 目标模块 |
| --- | --- | --- |
| 11-400 | `state`、常量、`elements` | `lib/state.mjs`、`lib/dom.mjs` |
| 502-723 | 路由、dev 页、`showPage` | `lib/router.mjs` |
| 724-2300 | 项目 workflow、reminder、workbench 单元格 | `domain/project-workflow.mjs`、`domain/project-reminders.mjs`、`components/project-workbench.mjs` |
| 2322-2680 | `fetchJson`、sync、filter select | `lib/api.mjs`、`components/filter-bar.mjs`、`components/sync-controls.mjs` |
| 2762-3140 | drill、owner tier board | `domain/metrics-display.mjs`、`components/drill-modal.mjs` |
| 3147-4730 | profile / overview 渲染 | `pages/franchise.mjs`、`pages/direct.mjs`、`pages/overview.mjs` |
| 4731-5280 | personnel、team owner 控件 | `domain/personnel.mjs`、`pages/teams.mjs` |
| 5282-9820 | team dashboard、owner review | `pages/teams.mjs`、`pages/owner-review.mjs` |
| 9828-10350 | project detail modal、workbench 列表 | `components/project-detail-modal.mjs`、`pages/details.mjs` |
| 10354-10754 | `renderAll`、`loadDashboard`、`init` | `app.js`（保留编排） |

---

## 6. 样式拆分策略

### 6.1 原则

- **与 JS 页面边界对齐**：改 `pages/teams.mjs` 时，主要改 `styles/pages/teams.css`。
- **保留设计 token**：颜色、圆角、间距、阴影进入 `tokens.css`，避免多处硬编码。
- **组件样式内聚**：tooltip、modal、filter-bar、insight-card 等进入 `components.css`。
- **不改变视觉口径**：本阶段只移动样式归属，不重做视觉设计。

### 6.2 加载方式（渐进切换）

**不要一次性替换 `styles.css`**。建议：

1. **Phase 0–3**：`index.html` 仍引用 `/styles.css`，新拆文件仅作开发备忘，或先在 `styles/app.css` 里 `@import` 试验。
2. **Phase 4 起**：每迁完一页，把对应样式从 `styles.css` 剪到 `styles/pages/*.css`，并在 `styles/app.css` 聚合。
3. **Phase 5**：`index.html` 改为只引 `/styles/app.css`；根目录 `styles.css` 删除或保留一版短注释说明已废弃。

```html
<!-- Phase 5 目标 -->
<link rel="stylesheet" href="/styles/app.css" />
```

内网环境可接受 `@import` 多请求；若需单文件产物，再在 Phase 6 评估构建合并。

### 6.3 验收标准

- 拆分后任意页面截图与拆分前相比，无肉眼可见布局差异（按项目规则，只验 2K 桌面端）。
- `tests/brand-ui.test.mjs` 中与 DOM/class 相关的断言仍通过。
- 页面悬停、选中、禁用、空状态等交互样式不丢失。

---

## 7. 测试策略

### 7.1 现有约束

`tests/publicAppBehavior.test.mjs` 既有做法：

1. 读取 `public/app.js` 全文；
2. 去掉 `import` 与尾部 `init()`；
3. 在 `vm` 沙箱中执行并暴露函数引用。

拆分后不再继续扩大源码拼接范围，改为稳定测试入口。

| 方案 | 做法 | 判断 |
| --- | --- | --- |
| **A. 测试 barrel** | 新增 `public/test-harness.mjs`，显式 re-export 被测函数 | 推荐；清晰、稳定 |
| **B. 多文件拼接** | harness 按序读取多个模块并拼接 | 脆弱，不推荐 |
| **C. 浏览器点验** | Playwright 或人工浏览器点验 | 可补充，不替代单元测试 |

本方案采用 **A**，但需注意：**代码拆成真实 ESM 后，现有 `vm` 拼接整文件的做法会失效**。

Phase 0 除新增 `test-harness.mjs` 外，还应确定测试加载方式（二选一，推荐 1）：

1. **Node 原生 `import()`**（推荐）：测试文件直接 `import { ... } from '../public/test-harness.mjs'`，用 fake DOM / mock `fetch` 注入；与生产模块图一致。
2. **过渡拼接**：Phase 1–2 暂保留对单文件拼接，Phase 3 起切到 `import()`；避免长期维持两套路径。

每完成一个 Phase，同步更新 `test-harness.mjs` 的 export 列表；`publicAppBehavior.test.mjs` 改为从 harness 导入，而不是 `readFile('app.js')`。

### 7.2 每个 Phase 必跑

```bash
node --test tests/publicAppBehavior.test.mjs tests/brand-ui.test.mjs tests/homeDirectorMetrics.test.mjs
```

如 Phase 涉及规则、Deadline、人员、指标或 API 契约，还必须追加对应专题测试。

### 7.3 人工点验清单

- [ ] 总览：KPI、风险队列、年度进店结构、drill 弹窗。
- [ ] 加盟 / 直营：profile 看板、drill。
- [ ] 小组：负责人切换、负载板、Agent 刷新。
- [ ] 项目详情：筛选、暂停项、表格视图、详情弹窗。
- [ ] 规则 / 开发文档：development 模式下入口与内容正常。
- [ ] 全局能力：同步按钮、hash 路由、筛选记忆、错误提示。

---

## 8. 执行计划（Strangler 渐进迁移）

> 原则：一次只迁一条线；每一步都可合并、可回滚、可独立验收。

### Phase 0：准备与基线

- [ ] 创建 `public/lib/`、`public/domain/`、`public/components/`、`public/pages/`、`public/styles/` 目录与必要 README 注释。
- [ ] 新增 `public/test-harness.mjs`，初期只 re-export 现有可测函数。
- [ ] 调整 `tests/publicAppBehavior.test.mjs` 使用 harness，行为断言不变；若从 `vm` 切到 `import()` 工作量较大，先完成测试入口迁移再进入 Phase 1。
- [ ] 记录拆分前 `app.js` / `styles.css` 行数基线。

**验收**：测试与现网行为一致；尚未迁移任何业务逻辑。

### Phase 1：抽 `lib/` 层

迁移：

- `fetchJson`、API 常量 → `lib/api.mjs`
- `escapeHtml`、`formatDate*`、`displayOrDash` → `lib/format.mjs`
- `state` 初始结构 → `lib/state.mjs`
- 稳定外壳级 `elements` 注册、通用 DOM 工具 → `lib/dom.mjs`
- `parsePageHash`、`showPage`、navigate 系列 → `lib/router.mjs`

**验收**：`app.js` 明显减薄；路由、API 与格式化相关测试通过。

### Phase 2：抽 `domain/` 层

迁移项目领域判断，包括 workflow、reminder、assignment、personnel 解析、metrics display 等。

要求：

- domain 模块不操作 DOM，不读取 `document`；
- 输入输出尽量是普通对象、数组、字符串或数字；
- 优先补纯函数单元测试。

**验收**：`project-workflow` / `project-reminders` 等相关测试仍绿；详情页与总览风险队列表现不变。

### Phase 3：抽 `components/` 层

建议顺序：

1. `components/filter-bar.mjs`
2. `components/drill-modal.mjs`
3. `components/project-workbench.mjs`
4. `components/project-detail-modal.mjs`
5. `components/sync-controls.mjs`

事件拆分同步进行：

- [ ] 先列出 `app.js` 的 `bindEvents` 事件清单。
- [ ] 全局事件留在入口或 shell 级组件；组件事件迁到对应 `components/*.mjs`。
- [ ] 页内事件暂不急着迁，等 Phase 4 迁页面时随该页进入 `pages/*.mjs`。

**验收**：筛选、钻取、详情弹窗、同步流程人工点验通过。

### Phase 4：按页迁移 `pages/`

建议从独立页面迁到复杂页面：

| 顺序 | 页面 | 理由 |
| ---: | --- | --- |
| 1 | `rules.mjs` | development-only，依赖少 |
| 2 | `developer-docs.mjs` | 同上 |
| 3 | `details.mjs` | 边界清楚，业务价值高 |
| 4 | `franchise.mjs` + `direct.mjs` + `profile-shared.mjs` | 结构相似，先抽共用再留薄封装 |
| 5 | `owner-review.mjs` | 体量大；作为 teams 子模块迁出 |
| 6 | `teams.mjs` | 编排 team metrics + import owner-review |
| 7 | `overview.mjs` | 最复杂，最后迁 |

每迁完一页：

- [ ] 将 `app.js` 中该页 `load/render` 改为 import 调用。
- [ ] 将该页 DOM 引用从中心化 `elements` / `querySelector` 迁到本页 `mount(ctx)` 或本地辅助函数。
- [ ] 将该页专属事件迁到本页 `bindEvents(ctx)`。
- [ ] 更新 `public/test-harness.mjs`。
- [ ] 跑测试并完成该页人工点验。
- [ ] 同步拆对应的 `styles/pages/*.css`。

**验收**：7 个导航页（overview / franchise / direct / teams / details / rules / developer-docs）各有对应 `pages/*.mjs`；`owner-review` 作为 `teams` 子模块存在于 `owner-review.mjs`；`app.js` 只保留入口编排。

### Phase 5：样式汇总与收尾

**建议 PR 粒度**：每个 Phase 或「单页迁移 + 对应 CSS」单独合并，便于回滚。

| Phase 结束 | `app.js` 目标行数（约） |
| --- | ---: |
| Phase 1 | ≤ 9,500 |
| Phase 2 | ≤ 8,000 |
| Phase 3 | ≤ 6,000 |
| Phase 4 | ≤ 800 |
| Phase 5 | ≤ 800（dead code 清理后） |

- [ ] `styles.css` 拆尽，根目录只保留历史兼容说明或移除引用。
- [ ] `styles/app.css` 成为样式聚合入口。
- [ ] 删除 `app.js` 中已迁走的 dead code。
- [ ] 更新 `docs/handbook/development.md` 的目录职责说明。
- [ ] 更新 `docs/STATUS.md` 的完成项。

**验收**：CSS/JS 目录结构与本文档一致；全量 `node --test` 通过。

### Phase 6（可选）：Vite 仅作 dev 工具

触发条件：文件数明显增加，且本地开发频繁受多文件刷新、模块缓存或手工合并影响。

- `vite` 仅作为 devDependency。
- 生产仍为静态文件 + Node 后端。
- 不改变 runtime 架构，不作为本方案必做项。

---

## 9. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 拆分引入回归 | 每 Phase 跑测试 + 固定人工点验清单；不混合「拆分 + 新功能」 |
| 循环依赖 | 严格遵守第 4.2 节依赖方向；同层复用下沉到更低层 |
| 测试 harness 过期 | 新模块导出时同步更新 `public/test-harness.mjs` |
| state 被多模块直接改乱 | 本阶段保留共享 `state` 对象；写入集中在 load/render 流程；reducer 另列独立方案评估 |
| CSS 拆分漏样式 | 按页面点验；`brand-ui` 测试兜底 |
| 范围膨胀 | 严格按 Phase 顺序推进，不并行迁两页 |
| 业务口径被顺手改动 | 拆分 PR 中不调整指标、Deadline、提醒、字段语义 |

---

## 10. 完成定义（Definition of Done）

满足以下全部条件，视为前端大单体拆分完成：

1. `public/app.js` **≤ 800 行**，仅负责入口与编排（`loadDashboard` / `renderAll` 可位于 `lib/dashboard-loader.mjs`）。
2. 7 个导航页均有 `public/pages/*.mjs`；`owner-review.mjs` 作为 `#teams` 内嵌子模块，不单独占导航位。
3. 加盟/直营共用逻辑位于 `pages/profile-shared.mjs`，`franchise.mjs` / `direct.mjs` 保持薄封装。
4. 项目 workflow、reminder、personnel、metrics 等领域逻辑位于 `public/domain/`，且无 DOM 依赖。
5. 通用 API、格式化、DOM、路由、state 能力位于 `public/lib/`。
6. 复用 UI 能力位于 `public/components/` 或已有 `public/dashboard/`。
7. `public/styles.css` 不再作为唯一样式文件，样式由 `public/styles/app.css` 聚合。
8. `node --test` 全绿，至少包含 `publicAppBehavior.test.mjs`、`brand-ui.test.mjs`、`homeDirectorMetrics.test.mjs`。
9. 人工点验清单全部通过，且按 2K 桌面端确认无明显视觉回归。
10. `docs/handbook/development.md` 与 `docs/STATUS.md` 已同步更新。

---

## 11. 与零 npm 依赖策略的关系

本方案不冲突于「少依赖 / 零 runtime 依赖」原则：

- 拆分是文件组织调整，不是框架迁移。
- 浏览器继续直接加载原生 ES Module。
- Node 测试通过 `public/test-harness.mjs` 读取明确导出，不依赖打包器。
- 若引入 Vite，只作为开发期工具，不改变生产运行时架构。

---

## 12. 与代码事实对齐（实施前必读）

| 事实 | 对方案的影响 |
| --- | --- |
| `#owner-review` 是 legacy hash，会重定向到 `#teams` | `owner-review.mjs` 是子模块，不是第 8 个导航页 |
| `owner-review` UI 全部在 `index.html` 的 `#teams` 区块内 | 迁 CSS 时用 `teams.css` + `owner-review.css`，JS 由 `teams.mjs` 编排 |
| `public/dashboard/` 已存在约 10 个模块 | 物理路径不变，仅逻辑上归类为 components 层 |
| `tests/publicAppBehavior.test.mjs` 约 2,500 行 | 测试迁移工作量不小，Phase 0 必须预留 |
| `index.html` 约 750 行 | 本方案不拆 HTML；仅确保 script/css 引用路径正确 |
| `app.js` 的 `bindEvents` 约 90 行，绑定点较多 | Phase 3 先拆事件清单，再按全局/组件/页面归属迁移 |
| 中心化 `elements` 会沉淀大量页面 DOM 引用 | `lib/dom.mjs` 只收外壳级元素，页面 DOM 随 `pages/*.mjs` 迁移 |
| P2 本地编辑表单会增加复杂交互 | 本方案只预留落点，不实现表单能力 |
| 静态资源由 `server.mjs` 的 `serveStatic` 递归提供 | `public/styles/`、`public/pages/` 无需改后端 |

---

## 13. 参考

- 开发规范：`docs/handbook/development.md`
- 状态文档：`docs/STATUS.md`
- 前端行为测试：`tests/publicAppBehavior.test.mjs`
- 已有部分拆分：`public/dashboard/*.mjs`
