# 部门团队运转 Agent 快照契约

## 目标

小组情况页「进店压力看盘」右侧使用 `departmentOperations` Agent 做全部门团队整体分析。它不替代图表，而是基于全部负责人小组的同口径快照，给当前小组输出相对部门的承接建议：多承接、稳承接、少承接或数据待补。

该 Agent 是运营排期辅助，不做绩效评价。

## 输入快照

`GET /api/team-metrics-batch` 会在同一个 `dashboardContext` 下计算所有请求 owner 的指标，并生成顶层 `departmentOperations`。

每个团队进入 Agent 的压缩快照包含：

| 字段 | 含义 |
| --- | --- |
| `owner` / `displayName` | 负责人小组 |
| `analysisMonth` | 当前进店压力判断月份 |
| `currentPressureScore` | 当前月进店压力值 |
| `peakPressureMonth` / `peakPressureScore` | 年内压力峰值月份和压力值 |
| `activeProjects` | 当前推进项目数 |
| `delayedProjects` / `highRiskProjects` | 延期与高风险遗留 |
| `responsibleWeightedWorkload` | 剩余责任人月 |
| `highDifficultyCount` | 难 / 重项目数 |
| `overloadedPeople` / `availablePeople` | 协作负载 Agent 识别的偏满与可承接人数 |
| `entryDateCoverage` | 进店月份覆盖率 |
| `dataRisk` | 是否缺少关键口径 |

快照会生成 `inputSnapshotHash`。后续接真 LLM 时，模型只能引用快照里的人员、月份和数字。

## 输出结构

顶层 `departmentOperations` 包含：

- `channel = departmentOperations`
- `agentName = 部门团队运转分析 Agent`
- `promptVersion` / `promptHash`
- `inputSnapshotHash`
- `facts.teamCount` / `readyTeamCount` / `dataRiskTeamCount`
- `teams[]`
- `ownerRecommendations`
- `currentOwnerRecommendation`
- `departmentRecommendations`
- `limitations`

每个 `metricsByOwner[owner]` 会注入精简版：

- `departmentOperations.ownerRecommendation`
- `departmentOperations.departmentRecommendations`
- `departmentOperations.limitations`
- `agentWorker.channels.departmentOperations`

前端右侧只展示当前 owner 的 `ownerRecommendation`，顶层快照保留给调试、复跑和未来真 LLM。

## 承接建议口径

`stance` 只允许：

| stance | 展示 | 使用场景 |
| --- | --- | --- |
| `more` | 多承接 | 当前压力和责任人月低于部门均值，且无明显遗留风险 |
| `steady` | 稳承接 | 当前小组接近部门中位区间，适合维持节奏 |
| `less` | 少承接 | 当前压力、剩余责任人月、延期/高风险或协作偏满高于部门水平 |
| `dataRisk` | 数据待补 | 进店压力、项目数或剩余难度缺失，判断降级 |

数据缺失不会中断通道；会写入 `limitations`，并在前端提示。

## Prompt 边界

Prompt 已固定在 `src/backend/agents/departmentOperationsAgentPrompt.mjs`：

- 每次只分析一个 `dashboardContext`。
- 必须输出结构化 JSON。
- 必须给每个 owner 产出相对部门的承接建议。
- evidence 只能引用输入快照。
- 禁止编造项目、人员、日期或原因。
- 禁止使用绩效评价表达。

## 复跑方式

开发阶段的 deterministic JS 结果就是 LLM 接入前的模拟分析。后续补齐团队成员、负责人归属或项目口径后，重新请求：

```text
GET /api/team-metrics-batch?context=all&owner=负责人A&owner=负责人B...
```

即可生成新的 `departmentOperations`、`promptHash` 和 `inputSnapshotHash`。接入真 LLM 时应保持输出结构不变，只替换生成器。
