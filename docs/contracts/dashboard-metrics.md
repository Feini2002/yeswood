# 看板指标与 Profile 契约

> 状态：指标总览 + Dashboard Profile 口径契约。  
> 实现层：`src/backend/metrics/`、`src/backend/teamInsights.mjs`。  
> 相关契约：[数据权威与钉钉导入契约](./data-authority.md)、[人员与责任身份契约](./personnel-and-responsibility-routing.md)、[Agent API 契约](./agents-api.md)。

## 指标设计原则

- 指标用于辅助管理，不替代业务判断。
- 指标来自本地最终项目数据和清洗层，不直接从前端计算钉钉原始数据。
- 如果本地字段与钉钉导入字段冲突，指标优先使用本地最终字段。
- 指标口径必须可解释。
- 指标变更必须写入本文档。

## 字段语义

钉钉同名列在本系统中语义不同，不可混用。

| 语义层 | 钉钉原始字段 | 标准字段 key | 用途 | 禁止用法 |
| --- | --- | --- | --- | --- |
| **priority** 优先级 | `项目状态` | `status` | 紧急 / 一般等管理优先级 | 不得用于未开始、进行中、完成判定 |
| **workflow** 流程阶段 | `硬装项目进度`、`软装项目进度` | metrics 层读取 rawFields | 未开始、平面、施工图、摆场、闭环等 | 不得与 priority 互换 |
| **scheme** 方案节点 | `硬装方案情况（每周五刷新）`（别名 `硬装方案情况`） | metrics 层读取 rawFields | 准时完成、延期完成、延期中等 | 不得单独用 `isDelayed` 回退替代 |

旧版误用 `项目状态` 作为流程状态，会导致未开始 = 0、进行中虚高等问题；小组看板与多看盘指标均已改为读取 workflow / scheme 字段。

辅助语义：

| 语义 | 字段 | 说明 |
| --- | --- | --- |
| 店态 tier | `店态` | `常规店`、`下沉店`、`高标店` 等；KPI 分行以 `常规店` / `下沉店` 为主 |
| 板块 scope | `组别` | `直营`、`加盟`；用于 direct / franchise profile |
| 设计责任闭环 closed | `平面开始时间`、`躺平内部审核结束时间`、`点位完成情况`、`点位完成时间`、`软装完成情况`、`软装完成时间` | 硬装按平面方案责任闭环；软装公司阶段按点位与方案两段都完成闭环 |
| 开业边界 due | `计划开业时间` / `计划完成日期` | 仅作为 `openDelayed` 的管理边界 OR 条件，且须 `!isDesignResponsibilityClosed(project)`；不作为设计阶段下一提醒 |

## 两维正交：店态 × 责任线

看板 KPI 由两个互不推导的维度组成，禁止用店态推断应看哪条责任线进度。

| 维度 | 含义 | 数据来源 | 作用 |
| --- | --- | --- | --- |
| 店态 tier | 常规店、下沉店、高标店等 | `店态` | 仅决定项目落在哪一行 KPI；不决定读硬装还是软装 |
| 责任线 discipline | CD 硬装轨、VM 软装轨 | `硬装项目进度`、`软装项目进度` | 双轨独立判定；流程 KPI 在同店态行内对两轨做 OR 合并 |

约定：

- `regular` = `店态 === '常规店'`；`sinking` = `店态 === '下沉店'`。
- 未开始 = 硬装或软装任一侧未开始。
- 进行中 = 硬装进行中或软装进行中，软装「暂停」计进行中。
- 已废弃：按 tier 绑定单轨，例如“常规店只看硬装”“下沉店只看软装”。

## 当前核心指标

### 项目总数

当前筛选条件下的项目数量。

### 推进项目

未被识别为完成、取消或关闭的项目数量。

### 开业边界逾期项目

满足以下条件：

- 有计划开业时间 / 计划完成日期。
- 项目未完成。
- 计划开业时间 / 计划完成日期早于当天。

该口径是管理边界统计，不等同于硬装/软装阶段延期，也不驱动项目明细“下一提醒”。

### 高风险项目

当前只基于风险字段识别。如果钉钉表暂时没有稳定风险字段，高风险数量可能为 0。后续可增加规则，例如延期超过一定天数自动提升风险等级。

### 平均进度

如果本地已维护最终进度，优先使用本地最终进度；否则按钉钉百分比或阶段枚举估算。

## Profile 总览

| profileId | 对应钉钉看盘 | scope 范围 | tier 分层 | API |
| --- | --- | --- | --- | --- |
| `department` | 项目统计仪表盘 / 部门总盘 | 全部有效项目 | 可选按店态 | `GET /api/dashboard-metrics?profile=department` |
| `direct` | 直营项目统计仪表盘 | `组别` 含「直营」 | 可选按店态 | `GET /api/dashboard-metrics?profile=direct` |
| `franchise` | 加盟项目统计仪表盘 | `组别` 含「加盟」 | 可选按店态 | `GET /api/dashboard-metrics?profile=franchise` |
| `ownerMonthly` | 管理员专用仪表盘（月度） | 自然人 owner 命中 `负责人` 列；责任身份 owner 命中对应硬/软装 slot + `dashboardContext` | 必须输出常规店 / 下沉店双行 | `GET /api/dashboard-metrics?profile=ownerMonthly&owner=&context=franchise` 或 `GET /api/team-metrics?owner=&context=franchise` |

### ownerMonthly scope

满足以下全部条件才计入该负责人月度盘：

- 普通自然人 owner：`负责人` 拆分后包含该 owner，支持别名。
- 责任身份 owner：`owner` 可传 `identityId` 或展示名；硬装身份只命中 CD / 硬装负责人 slot，软装身份只命中 VM / 软装负责人 slot。
- 仅总 `负责人` 列命中多身份自然人时进入待核对通道，不进入任一 ownerMonthly 个人盘。
- 创意团队成员不是 ownerMonthly 扩 scope 的依据；其组长 / 设计师责任项只在人员统计、组长负载和设计师负载中按槽位拆入责任身份。
- `dashboardContext` 匹配看盘：`franchise` = `组别` 含「加盟」；`direct` = 含「直营」；`all` = 不叠加组别。
- 不使用本地 `cdLeads` / `vmLeads` 挂载扩 scope。

## KPI 六元组契约

每个 KPI 统一描述六元组：scope、tier、fieldBindings、predicate、dateField、excludeRules。

### notStarted — 未开始

| 属性 | 值 |
| --- | --- |
| scope | profile 范围 + ownerMonthly 负责人团队 |
| tier | 仅筛店态：`regular` / `sinking` |
| fieldBindings | `workflow.hard` ← `硬装项目进度`；`workflow.soft` ← `软装项目进度` |
| predicate | `isHardNotStarted(project)` 或 `isSoftNotStarted(project)` |
| dateField | 无 |
| excludeRules | 不使用 `项目状态` / `status`；单侧已闭环或完成不抵消另一侧未开始 |

### inProgress — 进行中

| 属性 | 值 |
| --- | --- |
| scope | 同 notStarted |
| tier | 同 notStarted |
| fieldBindings | `workflow.hard` ← `硬装项目进度`；`workflow.soft` ← `软装项目进度` |
| predicate | `isHardInProgress(project)` 或 `isSoftInProgress(project)`，软装「暂停」计进行中 |
| dateField | 无 |
| excludeRules | 不使用 `项目状态` / `status`；禁止按 tier 切换单轨 |

### openDelayed — 未闭环延期

| 属性 | 值 |
| --- | --- |
| scope | 同 notStarted |
| tier | 同 notStarted |
| fieldBindings | `workflow.hard`、`workflow.soft`、`scheme`、`due` |
| predicate | `!isDesignResponsibilityClosed(project)` 且（`scheme` 含「延期」或 `dueDate < today` 且未完成） |
| dateField | 无 |
| excludeRules | 设计责任已闭环不计；`isDelayed` 不得单独作为方案延期 KPI |

### schemeDoneYtd — 今年已完成方案

| 属性 | 值 |
| --- | --- |
| scope | 同 notStarted |
| tier | 同 notStarted |
| fieldBindings | `scheme` ← `硬装方案情况（每周五刷新）` |
| predicate | `scheme` 匹配 `/准时完成\|延期完成/` |
| dateField | 使用方案/审核/上会等业务日期，不使用 `startDate` |
| excludeRules | 不看 `项目状态` 是否完成 |

### schemeDelayDoneYtd — 今年方案延期完成累计

| 属性 | 值 |
| --- | --- |
| scope | 同 notStarted |
| tier | 同 notStarted |
| fieldBindings | `scheme` |
| predicate | `scheme` 含「延期完成」 |
| dateField | 同 schemeDoneYtd |
| excludeRules | 仅认 scheme 字段，不用 `isDelayed` 回退 |

### schemeDelayDoneMonth — 本月方案延期完成

| 属性 | 值 |
| --- | --- |
| scope | 同 notStarted |
| tier | 同 notStarted |
| fieldBindings | `scheme` |
| predicate | `scheme` 含「延期完成」 |
| dateField | 优先 `updatedAt` 与上会/方案相关时间列 |
| excludeRules | dateField 年月 = 当前自然月；不用 `isDelayed` 回退 |

## monthlyOps — 本月运转量

`monthlyOps` 作为 ownerMonthly API、总览矩阵和钉钉对账的月度运转口径；当前小组情况前端不再渲染独立 `monthlyOps` 中间板块，也不再提供对应 LLM 分析入口。

责任制边界：

- 硬装设计责任只覆盖 `平面开始时间` 到 `躺平内部审核结束时间`；施工图外包节点只做公司项目进度记录。
- 软装设计责任拆为点位设计与方案设计两段；点位设计师按点位完成证据独立闭环，软装设计师按软装方案完成证据独立闭环。
- 产品清单字段保留记录，但理解为外部产品清单接收，不推动首页主流程阶段。

| KPI | 责任线 | 字段绑定 | 判定规则 |
| --- | --- | --- | --- |
| `hardMeetingMeasureVolume` | 硬装 | `上会日期`、`复尺时间` | 任一日期在本月 |
| `hardPlanVolume` | 硬装 | `平面开始时间`、`躺平内部审核结束时间` | 任一日期在本月 |
| `hardConstructionVolume` | 公司协同 | `施工图初稿完成时间`、`施工图完成审核时间` | 任一日期在本月；只做项目进度记录 |
| `pointVolume` | 软装 | `点位完成情况`、`点位完成时间` | 点位有进展且完成时间在本月 |
| `productListVolume` | 公司协同 | `产品清单发出时间` | 产品清单到达/接收时间在本月 |
| `schemeVolume` | 软装 | `软装方案开始时间` | 方案开始时间在本月，不要求先有产品清单 |
| `purchaseVolume` | 公司协同 | `采购时间` | 采购时间在本月 |
| `siteVolume` | 公司协同 | `软装项目进度`、摆场/发项目群日期 | 进度含「摆场 / 闭环」且相关日期在本月 |

## 各 Profile KPI 清单

| KPI | department | direct | franchise | ownerMonthly |
| --- | --- | --- | --- | --- |
| notStarted | ✓ | ✓ | ✓ | ✓（按 tier 分行） |
| inProgress | ✓ | ✓ | ✓ | ✓ |
| openDelayed | ✓ | ✓ | ✓ | ✓ |
| schemeDoneYtd | ✓ | ✓ | ✓ | ✓ |
| schemeDelayDoneYtd | ✓ | ✓ | ✓ | ✓ |
| schemeDelayDoneMonth | ✓ | ✓ | ✓ | ✓ |
| monthlyOps.* | 可选汇总 | 可选汇总 | 可选汇总 | ✓（API 输出；小组页暂不单独展示） |

## 小组看板洞察规则

小组看板 `/api/team-metrics` 返回 `insights`、`benchmark`、`comparisons`、`tooltipCatalog`，由 [`src/backend/teamInsights.mjs`](../../src/backend/teamInsights.mjs) 规则引擎生成。

小组看板批量接口 `/api/team-metrics-batch` 额外生成 `departmentOperations` Agent。该 Agent 同时参考同一 `dashboardContext` 下请求到的全部负责人小组，输出当前小组相对部门的承接建议：多承接、稳承接、少承接或数据待补。契约见 [Agent API 契约](./agents-api.md)。

## 个人看盘参考：范嘉瑞（非系统立法）

范嘉瑞（Jarvan范嘉瑞）钉钉截图仅作 `scripts/metrics-calibration.mjs` 的人工 diff 参考，不是全站 KPI 的立法依据。

注意：

- 钉钉个人盘中的「常规店」行可能合并多种店态，不等同于系统契约里的 `店态 === '常规店'`。
- 历史上该盘曾用「常规行看硬装、下沉行看软装」的单轨习惯反推实现；系统立法已改为“两维正交”。
- fixture：`tests/fixtures/dingtalk-benchmark-fanjiaRui.json` 及 `tests/fixtures/benchmarks/*` 仅供对账打印。

## 校准与变更流程

1. 修改任一 KPI 的 predicate / dateField / excludeRules 时，必须同步更新本文档。
2. 运行 `node scripts/metrics-calibration.mjs`，阅读 `DingTalk KPI diffs`，判断是数据漂移、个人盘差异还是口径 bug。
3. 需要立法级地面真值时，以钉钉卡片弹窗项目清单 + `scripts/dingtalk-parity-audit.mjs` 差集为准定稿 dateField。
4. 旧口径（用 `项目状态` 判断未开始、`isSchemeDelayed` 回退 `isDelayed`、tier 单轨）已废弃，仅作历史排查参考。

## 注意事项

- 当前指标是运营辅助视图，不作为绩效结论。
- 本地覆盖字段应有审计记录，避免指标口径无法追溯。
- 如果钉钉录入不完整，看板会如实暴露“未填写”。
- 如果字段映射错误，看板指标会失真，应优先修复字段契约。
- 如果同一负责人字段中有多人，普通自然人仍会合并为一个显示值；已配置责任身份的自然人按身份 id 拆分负载，无法判定责任线的总列命中进入待核对通道。

