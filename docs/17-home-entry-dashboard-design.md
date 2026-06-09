# 首页年度进店结构看板需求设计

> 状态：需求设计稿（已确认业务范围方案 A）  
> 更新日期：2026-06-09  
> 适用范围：首页新增「年度进店结构」大模块  
> 关联口径：[看板指标与 Profile 契约](./contracts/dashboard-metrics.md)、[数据权威与钉钉导入契约](./contracts/data-authority.md)、[字段映射契约](./contracts/field-mapping.md)、[当前状态与路线图](./STATUS.md)  
> 实现锚点：`src/backend/metrics/fieldSemantics.mjs`（`readStoreNatureKey` / `readStoreNatureLabel` / `readFranchiseScope`）、`src/backend/metrics/pausedProjects.mjs`（`isPausedProject`）、`src/backend/projectStatus.mjs`（`isTerminalProjectStatus`）、`src/backend/metrics/composeDashboard.mjs`（当前年度入口参考）；`public/dashboard/home-director-metrics.mjs` 仅作首页现有口径对齐参考，不作为后端聚合的直接导入对象。

## 1. 背景与目标

首页需要新增一个独立的「年度进店结构」大模块，用于观察部门全年进店节奏、直营 / 加盟结构、新店 / 老店结构、店态结构和区域分布。

该模块只参考钉钉截图表达的业务方向，不沿用钉钉表单的拆分方式和展示逻辑。本系统不再拆成「新店项目量」和「老店项目量」两个独立模块，而是整合为一个可下钻的年度进店结构看板。

模块核心回答：

- 今年每个月进店量是多少。
- 每个月新店和老店分别多少。
- 新店 / 老店内部直营和加盟分别占多少。
- 某个月的进店压力主要来自哪些店态。
- 某个月的进店项目集中在哪些省份。
- 年度总览、月份下钻和区域下钻的数据是否完全一致。

### 1.1 与现有看板的边界

| 模块 | 位置 | 时间维度 | 核心问题 | 是否复用本模块数据 |
| --- | --- | --- | --- | --- |
| **年度进店结构**（本期） | 首页大模块 | 选定自然年 / 月，`startDate` | 全年节奏、新老店与直营加盟结构 | — |
| 指挥条进店数 | 首页指挥条 | 当年 YTD 单值 | 快速总览今年进店规模 | 应与 `totals.entry` 在同 year、同 scope、同排除规则下对齐 |
| 省份 × 店态矩阵 | 首页现有面板 | 当前在营快照 | 区域 × 店态的在盘分布 | **不共用**；矩阵看现状，本模块看历史进店事实 |
| 进店压力看盘 | 小组情况页 | 负责人团队 + 在推进子集 | 压力分、难度、排产研判 | **不共用**；小组页可保留 `updatedAt` 回退并标注，本模块禁止 |

本模块定位：**结构性统计**（量、结构、分布）。人员负载、延期风险、AI 研判、压力分不在本期范围。

## 2. 已确认统计口径

### 2.1 进店项目范围（方案 A：直营 + 加盟）

进店量按「进店事实」统计，而不是按当前是否仍在推进统计。

**系统有效业务范围（已确认）**：

- 仅统计 `组别` 可识别为 **直营** 或 **加盟** 的项目。实现以 `readFranchiseScope(project) ∈ {direct, franchise}` 为准，并与首页指挥条现有口径对齐。
- `组别` 无法命中直营或加盟的项目 → 计入 `unclassifiedScope`，**不进入主图柱体**，在数据说明中显式展示数量。
- 本模块 **不等于** `department` profile 全量；`department` 中 scope 为 other 的项目在本模块视为未归类。

计入规则：

- `startDate` 落在选定年份或选定月份内。
- 项目属于上述直营 / 加盟有效范围。
- 已闭环项目仍然计入，因为闭环不改变历史进店事实。

排除规则（见 §2.7 可执行判定）：

- 暂停项目不计入。
- 取消 / 关闭项目不计入。
- `startDate` 缺失的项目不计入进店量，计入数据质量提示。

未进入主图但仍需显式计数的项目：

- 新老店无法识别 → `unclassifiedStoreAge`
- 组别无法识别直营 / 加盟 → `unclassifiedScope`

### 2.2 代码与展示映射

实现与测试必须使用下表，避免「老店 / 翻新店 / renovated」混用：

| 界面展示 | 语义 key | 代码实现 | 说明 |
| --- | --- | --- | --- |
| 新店 | `newStore` | `readStoreNatureKey(project) === 'newStore'` | 字段含「新店」等 |
| 老店 | `oldStore` | `readStoreNatureKey(project) === 'renovated'` | 含老店、翻新、改造、扩店、换址、重装 |
| 未识别店型 | `unclassifiedStoreAge` | `readStoreNatureKey(project) === 'other'` | 不进入新店 / 老店柱 |
| 直营 | `direct` | `readFranchiseScope(project) === 'direct'` | `组别` 命中直营语义 |
| 加盟 | `franchise` | `readFranchiseScope(project) === 'franchise'` | `组别` 命中加盟语义 |
| 未归类 scope | `unclassifiedScope` | `readFranchiseScope(project) === 'other'` | 不进入主图 |

补充：

- Profile 矩阵中的「新店-常规 / 翻新店-下沉」四段式（`STORE_SEGMENT_ORDER`）**不在本模块主图展开**；主图只做「新店 / 老店」双柱，店态下沉到 hover 与排行。
- 界面统一写「老店」；代码与 API 字段用 `oldStore`，内部语义层仍对应 `renovated`。
- 直营 / 加盟同义词以共享 helper 为准。若源数据确认存在「自营」等同义写法，应先扩展 `readFranchiseScope` 并补测试，不在本模块私有分支里单独处理。

### 2.3 时间口径

优先使用标准字段 `startDate`，对应钉钉「启动时间 / 启动日期」（见 [数据权威与钉钉导入契约](./contracts/data-authority.md)）。

年度筛选：

- 默认展示当前看板年份（`dashboardYear(now)`，与 `composeDashboard.mjs` 一致）。
- 支持切换历史自然年；切换后主图、详情、区域分布全部按新年份重算。
- 只统计 `startDate` 落在该自然年的项目。
- 1–12 月必须完整展示，即使某个月为 0 也保留月份位置。

月份筛选：

- 选中某月后，只统计该月 1 日至该月最后一天内进店的项目（按 `startDate` 自然日，本地时区与现有 `monthKey` 逻辑一致）。
- 月份详情、区域分布、hover 明细和项目下钻必须使用同一批月份项目。

**禁止 `updatedAt` 回退**：若 `startDate` 缺失或无法解析，暴露为数据质量问题，不得用更新时间替代进店事实。这与小组页 `monthlyEntry.usesUpdatedAtFallback` **有意分叉**——小组页可保留回退并标注，本模块不允许。

### 2.4 新店 / 老店口径

优先读取「店铺性质」及标准清洗字段（`readStoreNatureKey` / `readStoreNatureLabel`）。

| 分类 | 判定说明 |
| --- | --- |
| 新店 | 字段明确为新店，或语义层识别为新开项目 |
| 老店 | 字段明确为老店，或含改造、翻新、重装、扩店、换址等存量门店语义 |
| 未识别 | 字段为空或无法稳定归类；不进入新店 / 老店双柱，计入 `unclassifiedStoreAge` |

主图每个月固定两根柱子：新店、老店（仅含已识别店型且 scope 有效的项目）。

### 2.5 直营 / 加盟口径

沿用现有 profile scope 口径（与 `direct` / `franchise` profile 一致）：

- 直营：`readFranchiseScope(project) === 'direct'`。
- 加盟：`readFranchiseScope(project) === 'franchise'`。

不得用店态、项目名称或负责人反推直营 / 加盟。

### 2.6 店态口径

店态使用「店态」字段（`storeStatus` / `readStoreTier`），例如常规店、下沉店、高标店、旗舰店、黑标店、睡眠店、儿童店、维莎店等。

店态不作为主图柱体颜色的主要维度。主图颜色优先表达直营 / 加盟；店态进入 hover、月份详情和排行。

店态排行默认展示 **Top 8**，其余合并为「其他」；「其他」仍计入当月总量，hover 可展开明细。睡眠店等特殊店态按字段原值统计，不做额外排除。

### 2.7 排除规则（可执行判定）

与现有 KPI 层对齐，实现时优先复用后端共享 helper。前端 `home-director-metrics.mjs` 中的私有 helper 只能作为对账参考；若需要复用其逻辑，应先抽到后端共享模块并补测试。

| 类型 | 判定 | 实现参考 |
| --- | --- | --- |
| 暂停 | 硬装或软装项目进度含「暂停」 | `isPausedProject`（`pausedProjects.mjs`） |
| 取消 / 关闭 | `项目状态` ∈ {取消, 已取消, 关闭, 已关闭}，或硬装 / 软装进度文本命中 `/取消\|已取消\|关闭\|已关闭/` | `isTerminalProjectStatus` + 工作流文本匹配；如需与现有首页 helper 完全一致，先抽取共享 `isEntryExcludedProject` |
| 闭环（仍计入） | 双轨进度为闭环 / 完成 / 已完成，但 `startDate` 落在统计范围内 | 不排除；与「进店事实」一致 |
| scope 无效 | `组别` 无法识别直营或加盟 | 不计入主图，计入 `unclassifiedScope` |
| 店型未识别 | `readStoreNatureKey === 'other'` | 不计入主图柱，计入 `unclassifiedStoreAge` |
| 日期无效 | `startDate` 缺失或无法解析为合法日期 | 不计入进店量，计入 `missingStartDate` |

### 2.8 省份口径

省份使用标准字段 `province`，复用现有省份显示规范（`province-display.mjs`）。

区域子模块按省份聚合，不默认合并大区。若后续需要华东、华南等大区视角，另行定义，不在本期需求内。

省份缺失时展示为「省份未填写」，仍计入当月有效进店总量（在已通过 scope 与店型筛选的前提下）。

### 2.9 KPI 立法摘要（与 12 文档风格对齐）

**年度进店量 `entry`**

| 属性 | 值 |
| --- | --- |
| scope | 直营 ∪ 加盟（`readFranchiseScope(project) ∈ {direct, franchise}`） |
| tier | 无（本 KPI 不按店态分行） |
| fieldBindings | `startDate` ← 启动时间 / 启动日期 |
| predicate | `startDate` 落在选定自然年；且 `readStoreNatureKey ∈ {newStore, renovated}` |
| dateField | 仅 `startDate` |
| excludeRules | 暂停、取消 / 关闭排除；闭环保留；禁止 `updatedAt` 回退；`unclassifiedScope` / `unclassifiedStoreAge` / `missingStartDate` 不计入 `entry` 但计入 `dataQuality` |

实现完成后，若将本 KPI 纳入长期立法，须同步 [看板指标与 Profile 契约](./contracts/dashboard-metrics.md) 与相关测试。注意：现有 `departmentMetrics.currentYearEntry` 可能沿用更宽的 profile 范围，不得在未校验 scope、暂停 / 取消、店型识别规则前直接当作本模块 `totals.entry`。

## 3. 首页模块信息架构

模块名称：**年度进店结构**。

整体结构：

```text
年度进店结构
├─ 年份切换 / 数据说明 / 年度汇总（总进店 · 新店 · 老店 · 直营 · 加盟）
├─ 年度总览：1–12 月双柱堆叠图（柱内：直营 / 加盟）
├─ 月份详情（与主图选中月联动，首屏即展示默认月，非弹窗）
│  ├─ 四象限：直营新店 / 直营老店 / 加盟新店 / 加盟老店
│  └─ 店态排行 Top 8 + 其他
└─ 区域分布：省份排行 + 每省新店 / 老店拆分
```

## 4. 年度总览主图

### 4.1 图表形态

采用 1–12 月分组柱状图。

每个月固定两根柱子：新店柱、老店柱。

每根柱子内部按直营 / 加盟堆叠：

- 直营、加盟各用一种稳定颜色。
- 同一颜色在所有月份和下钻面板中保持一致。

主图不按店态拆颜色，避免颜色过多导致阅读困难。

### 4.2 主图展示内容

每个月展示：

- 当月新店总量（scope 有效且店型 = 新店）。
- 当月老店总量（scope 有效且店型 = 老店）。
- 各柱内直营 / 加盟数量。

年度汇总：

```text
年度进店总量（entry）
= Σ(各月新店总量 + 各月老店总量)
= totals.direct + totals.franchise   // 在柱内已归类部分
```

`unclassifiedStoreAge`、`unclassifiedScope`、`missingStartDate`、暂停 / 取消排除量 **不计入** `entry`，仅在数据说明区展示。

### 4.3 hover 明细

鼠标悬浮到某月某根柱子时，展示该月该类型的细分明细（与柱体同一批项目）。

示例：

```text
2026年 3月 · 新店进店 18 项

直营 7 项，占 39%
加盟 11 项，占 61%

店态结构（Top 8 + 其他）
常规店 8
下沉店 4
高标店 3
旗舰店 2
其他 1

省份 Top 5
浙江省 4
江苏省 3
四川省 2
```

## 5. 月份下钻交互

### 5.1 交互方式

点击某月后，在模块内部更新月份详情面板（非弹窗）。

点击行为：

- 点击月份标签或该月任意柱子 → 选中该月。
- **默认选中**：当前展示年份内，月份序号最大的、进店量 > 0 的月份；若全年为 0，不选中任何月，详情区展示空状态。
- 切换年份后，默认选中规则按新年份重新计算。
- 再次点击其他月份时，详情面板直接切换，无需二次确认。

首屏状态：主图 + **默认选中月的四象限与店态排行均可见**（不是「收起等点击」）；仅当全年无数据时详情区为空状态。

### 5.2 月份详情内容

四象限摘要：

```text
选中：2026年 3月

直营新店 7 项
直营老店 5 项
加盟新店 11 项
加盟老店 4 项
```

每个象限展示：项目数量、占当月有效进店比例、主要店态 Top 3、主要省份 Top 3。

### 5.3 店态排行

```text
店态排行
常规店  12 项
下沉店   8 项
高标店   4 项
旗舰店   3 项
…
其他     2 项
```

排行点击预留项目列表筛选参数（本期可先只做展示）：

- `year` = 当前年份
- `month` = 当前选中月份
- `storeStatus` = 当前店态
- `excludePaused` = 1
- `entryScope` = `directFranchise`（或等价进店范围参数；不要仅用普通 `department` profile 表达本模块范围）

### 5.4 月份详情的数据一致性

当月 **有效进店总量**（主图 + 详情 + 区域 + 店态排行共用）：

```text
month.total
= directNew + directOld + franchiseNew + franchiseOld
= month.newStore.total + month.oldStore.total
```

主图该月两根柱之和 = `month.total`。

`unclassifiedStoreAge`、`unclassifiedScope` 单独展示在数据说明，**不参与**上述等式。

## 6. 区域分布子模块

### 6.1 子模块定位

回答「选中月进店集中在哪些省份」。与首页「省份 × 店态矩阵」互补：矩阵看**在营快照**，本模块看**当月进店事实**。

本期不做地图，采用省份条形排行（2K 桌面端可读性优先）。

### 6.2 展示方式

与主图选中月份联动（顶部可显示当前月，无需独立再选一次）。

```text
2026年 3月 · 区域分布

浙江省  6 项    新店 4 / 老店 2
江苏省  5 项    新店 2 / 老店 3
…
```

每省展示：总进店量、新店数、老店数；可选 hover 展示直营 / 加盟小计。

省份超过 15 个时使用紧凑双列布局，不默认折叠隐藏。

### 6.3 区域下钻（预留）

点击省份预留筛选参数：

- `year`、`month`、`province`
- 排除暂停 / 取消；闭环项目保留

与现有项目列表 hash 参数对齐：`storeNature`、`entryScope`、`excludePaused` 等（见 `public/app.js` 路由筛选）；若复用 `profile` 参数，必须显式区分普通 `department` 全量与本模块 direct/franchise 进店范围。

## 7. API 与数据结构

### 7.1 API 建议

前端不应在多个组件内重复过滤项目。建议后端生成稳定的 `annualEntryStructure` 对象。

推荐新增或在 snapshot 中挂载：

```text
GET /api/dashboard-metrics?profile=department&entryScope=directFranchise&year=2026
  → payload.annualEntryStructure

或

GET /api/entry-structure?year=2026
```

聚合逻辑放在后端 / 统一模型层（可扩展 `composeDashboard.mjs` 或独立 `buildAnnualEntryStructure.mjs`），前端只渲染。

### 7.2 响应形态

```json
{
  "year": 2026,
  "totals": {
    "entry": 0,
    "newStore": 0,
    "oldStore": 0,
    "direct": 0,
    "franchise": 0
  },
  "dataQuality": {
    "missingStartDate": 0,
    "unclassifiedStoreAge": 0,
    "unclassifiedScope": 0,
    "excludedPaused": 0,
    "excludedCanceled": 0
  },
  "fieldCoverage": {
    "startDate": 0,
    "storeNature": 0,
    "province": 0,
    "businessGroup": 0
  },
  "months": [
    {
      "month": 1,
      "label": "1月",
      "total": 0,
      "newStore": {
        "total": 0,
        "direct": 0,
        "franchise": 0
      },
      "oldStore": {
        "total": 0,
        "direct": 0,
        "franchise": 0
      },
      "quadrants": {
        "directNew": { "total": 0, "storeStatuses": [], "provinces": [] },
        "directOld": { "total": 0, "storeStatuses": [], "provinces": [] },
        "franchiseNew": { "total": 0, "storeStatuses": [], "provinces": [] },
        "franchiseOld": { "total": 0, "storeStatuses": [], "provinces": [] }
      },
      "storeStatuses": [],
      "provinces": []
    }
  ]
}
```

**字段约定**：

- `newStore.direct + newStore.franchise = newStore.total`；老店同理。
- `quadrants.*.total` 与四象限一一对应；**不得**与 `newStore` / `oldStore` 双份独立计算后再拼装——应由同一批项目一次聚合，前端可 derive 汇总但后端只产出一份事实源。
- 月级 `storeStatuses` / `provinces` 为当月有效进店全集排行；象限内 `storeStatuses` / `provinces` 为该象限子集。

排行项统一结构：

```json
{
  "key": "浙江省",
  "label": "浙江省",
  "total": 6,
  "newStore": 4,
  "oldStore": 2,
  "direct": 3,
  "franchise": 3
}
```

## 8. 正确性约束

实现时必须保证：

1. `totals.entry` = 12 个月 `month.total` 之和。
2. 每个月 `month.total` = `newStore.total` + `oldStore.total`（仅 scope 有效且店型已识别项目）。
3. 每个月 `newStore.total` = `newStore.direct` + `newStore.franchise`；老店同理。
4. 四象限合计 = `month.total`：`directNew + directOld + franchiseNew + franchiseOld`。
5. 区域子模块省份 `total` 之和 = 当前选中月 `month.total`。
6. 店态排行 `total` 之和（含「其他」）= 当前选中月 `month.total`。
7. 暂停 / 取消项目在所有层级均排除，并计入 `dataQuality.excludedPaused` / `excludedCanceled`。
8. 闭环项目在所有层级均保留（只要 `startDate` 命中范围）。
9. hover、月份详情、区域排行、店态排行共享同一批月份项目 ID 集合。
10. 首页指挥条 `currentYearEntry` 与本模块 `totals.entry` 在同 year、同 scope 下数值一致（或文档化唯一允许差异并写测试）。

## 9. 首页布局建议

本项目首页按 2K 桌面端体验设计，不考虑移动端适配。

```text
┌──────────────────────────────────────────────────────────────┐
│ 年度进店结构                                                  │
│ [年份▼]  数据说明  总进店 / 新店 / 老店 / 直营 / 加盟           │
├──────────────────────────────────────────────────────────────┤
│ 1–12 月双柱堆叠图                                             │
├───────────────────────────────┬──────────────────────────────┤
│ 月份四象限详情（默认月已展示）   │ 店态排行 Top 8 + 其他          │
├───────────────────────────────┴──────────────────────────────┤
│ 区域分布：省份排行 + 新店/老店拆分                              │
└──────────────────────────────────────────────────────────────┘
```

视觉层级：

- 主图占模块最大面积。
- 月份详情随默认月 / 选中月即时展示，不用 accordion 收起主内容。
- 区域分布放在详情下方，跟随月份联动。
- 避免过多卡片嵌套。

## 10. 空状态与数据质量提示

模块头部「数据说明」需可展开，至少包含：

| 情况 | 展示方式 |
| --- | --- |
| 当年无有效进店 | 主图 12 月零柱 + 模块级空状态文案，不隐藏模块 |
| 某月无数据 | 主图保留 0 值位；选中该月时详情区空状态 |
| `startDate` 缺失 | `missingStartDate` 计数；禁止 `updatedAt` 替代 |
| 新老店未识别 | `unclassifiedStoreAge` 计数 |
| 组别未识别直营 / 加盟 | `unclassifiedScope` 计数 |
| 省份缺失 | 排行中显示「省份未填写」 |
| 字段覆盖偏低 | `fieldCoverage` 低于阈值时提示「趋势仅供参考」 |

## 11. 测试建议

至少覆盖（建议新建 `tests/annualEntryStructure.test.mjs`，并对齐 `tests/homeDirectorMetrics.test.mjs` 风格）：

- scope 为 other 的项目不计入 `entry`，计入 `unclassifiedScope`。
- 暂停 / 取消不计入；闭环仍计入。
- 12 个月之和 = `totals.entry`。
- 选中月：主图柱、四象限、区域、店态排行总数一致。
- 新店 / 老店柱内直营 + 加盟 = 柱总量。
- `missingStartDate` 不计入进店量。
- 禁止 `updatedAt` 回退（与 `monthlyEntry.usesUpdatedAtFallback` 行为对比的回归用例）。
- 指挥条 `currentYearEntry` 与 `totals.entry` 对齐。
- 随机项目集属性测试：§8 全部约束。

## 12. MVP 验收标准

本期必须交付：

- [ ] 年份切换 + 12 月双柱堆叠主图（直营 / 加盟堆叠）
- [ ] 默认月 / 点击月的四象限详情
- [ ] 店态排行 Top 8 + 其他
- [ ] 区域省份排行（与新 / 老店拆分）
- [ ] 数据说明（含 `dataQuality` 与关键 `fieldCoverage`）
- [ ] 后端单一聚合 + §8 一致性单测

## 13. 暂不纳入本期

- 地图可视化
- 大区维度汇总
- 进店量与人员负载、延期风险、排班的联动研判
- AI 自动总结
- 项目明细弹窗或完整列表改造
- 移动端布局
- 与小组页压力分 / 难度曲线的合并展示

数据结构稳定后可扩展：项目列表跳转、同比 / 环比角标、指挥条点击联动滚动等。
