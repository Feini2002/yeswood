# 当前状态与路线图

> 更新日期：2026-06-09  
> 用途：记录当前系统状态、近期路线图和文档收口记录。长期契约请看 `docs/contracts/` 与 `docs/rules/`。

## 当前阶段

系统已经从 mock 原型推进到真实钉钉 AI 表格数据驱动，并接入 SQLite 本地主数据底座第一版。

当前事实：

```text
数据来源：钉钉 AI 表格导入
初始化录入：钉钉 AI 表格
最终数据源：data/app.sqlite
兼容缓存方式：data/dashboard-cache.json
人员主数据：SQLite personnel_* 表；data/personnel-database.json 作为种子和回退线索
前端数据来源：本系统后端 API
是否写回钉钉：否
是否实时同步：否
当前记录数：约 506
当前字段数：约 52
```

## 已具备能力

- 后端获取 token，调用 records/list，并处理 `hasMore` / `nextToken` 分页。
- 同步导入写入 `data/app.sqlite`，JSON 快照保留为兼容和回退线索。
- `/api/projects`、`/api/metrics`、`/api/filters` 优先读取 SQLite 最终项目视图；数据库未 seeded 时回退 JSON 快照。
- 前端只请求本系统 `/api/*`。
- 前端展示总览、加盟看板、直营看板、小组情况、负责人复盘、项目情况、项目详情弹窗、drill-down 列表和今日处理动作队列。
- 本地人员主数据优先于钉钉项目字段，用于真实角色、硬装 / 软装 / 共同承担、团队归属、别名、在职状态等管理口径。
- 硬装 Deadline 已有后端计算逻辑、工作日日历、规则文档、项目详情摘要、项目列表主提醒和 Deadline 复核入口。
- 自动化测试覆盖后端数据规则、指标计算、安全边界和关键前端结构。
- 前端大单体拆分已完成主体迁移：`public/app.js` 315 行入口编排；业务逻辑分布于 `lib/`、`domain/`、`components/`、`pages/`；`index.html` 引 `/styles/app.css`，根目录 `styles.css` 仅兼容重定向。计划必跑测试与全量 `node --test` 已通过。人工点验清单见拆分方案 §7.3，仍待 2K 桌面端走查。详见 [`handbook/frontend-split-plan.md`](./handbook/frontend-split-plan.md)。

## 近期路线图

### P1：业务口径稳定

- 明确本地覆盖字段范围。
- 建立钉钉值与本地最终值的差异记录。
- 完善字段别名、核心字段、默认展示字段配置。
- 对负责人数组进行拆分统计，避免多人负责人被合并成一个负载项。
- 区分硬装进度、软装进度、点位进度、采购进度。
- 硬装 Deadline 进入可写复核、双轨对账和正式 KPI 前置校准。

### P2：前端运营工作台

- 将现有页面从“只读看板”升级为“项目运营工作台”。
- 增加项目详情抽屉或详情页能力。
- 增加本地编辑入口。
- 增加字段配置和列展示配置。
- 增加差异确认视图。
- 按当前设计稿推进首页年度进店结构模块；生效需求稿见 [`17-home-entry-dashboard-design.md`](./17-home-entry-dashboard-design.md)，旧版追溯稿见 [`archive/page-specs/2026-06-home-entry-dashboard-design.md`](./archive/page-specs/2026-06-home-entry-dashboard-design.md)。

### P3：复盘与维护

- 增加历史快照。
- 增加趋势对比。
- 增加按月开业计划视图。
- 增加延期原因分类。
- 增加导出本地摘要。
- 视部署需要再考虑登录和权限分层。

## 文档收口记录

- 2026-06-08：已清理部分临时执行计划（小组情况融合、SQLite 执行计划、项目详情改版、桌面端打磨）。
- 2026-06-09：将 `docs/superpowers/` 历史设计稿、根目录审查报告、`docs/10` 需求记录稿迁入 `docs/archive/`，主索引不再列出。
- 2026-06-09：完成文档目录重构，主文档分为 `handbook/`、`contracts/`、`rules/` 与 `archive/`。
- 2026-06-09：合并 `05 + 12` 为 [`contracts/dashboard-metrics.md`](./contracts/dashboard-metrics.md)，合并 `11 + 15` 为 [`contracts/personnel-and-responsibility-routing.md`](./contracts/personnel-and-responsibility-routing.md)，合并 `00 + 04` 为 [`contracts/data-authority.md`](./contracts/data-authority.md)。
- 2026-06-09：`14` 硬装 Deadline 落地计划归档；首页年度进店结构看板保留为当前需求稿，旧版追溯稿放入 archive。

## 文档更新路由

| 改动类型 | 必须更新的文档 |
| --- | --- |
| 系统定位、数据权威链、钉钉导入契约 | [`contracts/data-authority.md`](./contracts/data-authority.md) |
| token、权限、同步保护、日志策略 | [`contracts/security-boundary.md`](./contracts/security-boundary.md) |
| 原始字段展示、字段格式化、前端表格列 | [`contracts/field-mapping.md`](./contracts/field-mapping.md) |
| 指标口径、筛选维度、profile KPI、图表规则 | [`contracts/dashboard-metrics.md`](./contracts/dashboard-metrics.md) |
| 人员主数据、责任身份、负责人路由 | [`contracts/personnel-and-responsibility-routing.md`](./contracts/personnel-and-responsibility-routing.md) |
| Agent 快照和 API 契约 | [`contracts/agents-api.md`](./contracts/agents-api.md) |
| 规则口径、Deadline、提醒、延期判定 | [`rules/operational-rulebook.md`](./rules/operational-rulebook.md) |
| 开发流程、测试方式、目录职责 | [`handbook/development.md`](./handbook/development.md) |
| 启动、同步、缓存、排障和事故处理 | [`handbook/operations.md`](./handbook/operations.md) |
| 架构决策 | [`contracts/decisions.md`](./contracts/decisions.md) |
| 当前状态、路线图、文档收口记录 | 本文 |

## 最近验证记录

本轮拆分收尾验证记录：

```text
node --test：392/392 通过
public 模块 import 冒烟：42/42 通过
备注：使用 Node 内置 node:sqlite 时会输出 ExperimentalWarning，当前为已知技术选择提示。
```
