# 文档索引

本目录约束空间视觉项目中台的产品方向、开发方式、安全边界和维护流程。按用途分区导航，不必逐篇通读。

## 必读入口

| 文档 | 说明 |
| --- | --- |
| [当前状态与路线图](./STATUS.md) | 当前系统状态、近期路线图、文档收口记录 |
| [运营规则正文](./rules/operational-rulebook.md) | 规则、Deadline、提醒、延期优先级的人类可读正文 |

## Contracts

| 文档 | 说明 |
| --- | --- |
| [数据权威与钉钉导入契约](./contracts/data-authority.md) | 系统定位、数据链路、钉钉导入与标准字段 |
| [安全边界](./contracts/security-boundary.md) | token、`.env`、SQLite、日志和接口安全 |
| [字段映射契约](./contracts/field-mapping.md) | 钉钉原始字段到前端展示名与字段目录 |
| [看板指标与 Profile 契约](./contracts/dashboard-metrics.md) | 指标总览、profile KPI、两维正交和校准规则 |
| [人员主数据与责任身份路由契约](./contracts/personnel-and-responsibility-routing.md) | 人员主数据、负责人责任身份、数据通道与待核对规则 |
| [部门团队运转 Agent 快照契约](./contracts/agents-api.md) | 小组情况页 Agent 输入输出与 prompt 边界 |
| [架构决策记录](./contracts/decisions.md) | 长期有效 ADR |

## 产品设计

| 文档 | 说明 |
| --- | --- |
| [首页年度进店结构看板设计](./17-home-entry-dashboard-design.md) | 首页「年度进店结构」模块需求（业务范围方案 A） |

## Handbook

| 文档 | 说明 |
| --- | --- |
| [开发跟进规范](./handbook/development.md) | 技术栈、目录职责、开发流程、文档更新路由 |
| [Git 与本地数据规范](./handbook/git-and-data.md) | 什么进 Git、换机恢复、首次 force push 清单 |
| [前端大单体拆分方案](./handbook/frontend-split-plan.md) | `app.js` / `styles.css` 拆分 Phase、边界与验收 |
| [运维与事故处理手册](./handbook/operations.md) | 启动、同步、排障、事故分级与恢复 |

## Rules

| 文档 | 说明 |
| --- | --- |
| [运营规则正文](./rules/operational-rulebook.md) | 人类可读规则正文；可执行矩阵见 `src/backend/hardDecorationDeadlineRules.mjs` |

## Archive

历史需求记录、设计稿、审查报告、页面规格和执行计划见 [`archive/`](./archive/)。归档文档仅供追溯，不代表当前生效口径。

## 当前系统一句话

基于钉钉 AI 表格导入的本地项目数据中台：钉钉负责初始化录入和外部事实输入，本地 SQLite 负责完整项目主数据、最终业务口径、覆盖记录和后续本地编辑。

## 规则维护同步约定

规则变更须按三层治理：可执行规则（`src/backend/hardDecorationDeadlineRules.mjs`、日历数据）→ 人类可读规则（`rules/operational-rulebook.md`）→ 运营展示（前端 `#developer-docs` 规则章节）。根目录 README 与公司背景只保留摘要和链接。详见 [`AGENTS.md`](../AGENTS.md)。
