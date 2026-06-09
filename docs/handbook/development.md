# 开发跟进规范

## 当前技术栈

- Node.js 原生后端。
- 静态前端页面。
- SQLite 本地主数据（`data/app.sqlite`）为第一版正式数据层；JSON 缓存保留为兼容快照。
- Node 内置测试框架 `node:test`。
- 继续保持少依赖，SQLite 访问必须封装在后端数据库模块内。

## 开发原则

- 先保护“不写回钉钉”的边界，再做功能。
- 先保证数据链路稳定，再做视觉增强。
- 先用清晰字段映射解决真实数据差异，再考虑复杂配置平台。
- 本地项目主数据优先于钉钉导入值，后续同步不能静默覆盖本地人工口径。
- 每次改后端核心行为都要补测试。
- 每次接入真实数据都只输出摘要，不输出敏感内容。

## 目录职责

```text
src/backend/config.mjs
  读取环境变量和路径配置。

src/backend/dingtalkClient.mjs
  获取 token，调用 records/list，处理钉钉响应格式。

src/backend/syncService.mjs
  控制 mock/真实同步，写入 SQLite 导入层和项目主表。

src/backend/projectData.mjs
  字段映射、字段清洗、风险/延期/指标计算。

src/backend/storage.mjs
  本地 JSON 缓存读写，作为兼容快照或测试辅助。

src/backend/database.mjs
  SQLite 连接、schema 初始化和 migrations。

src/backend/projectRepository.mjs
  本地项目主数据、覆盖记录、差异和审计读写。

src/backend/server.mjs
  API 与静态资源服务。后续可以增加只写本地 SQLite 的编辑 API。

public/
  当前看板前端（ES Module 分层结构，入口 `app.js` 仅编排）。
  `lib/`：api、format、state、dom、router、constants、dashboard-loader、runtime-flags、view-coordinator
  `domain/`：project-workflow、project-reminders、project-display、personnel、metrics-display
  `components/`：filter-bar、drill-modal、project-workbench、project-detail-modal、project-cell-render、sync-controls、team-hero-stat
  `pages/`：overview、franchise、direct、profile-shared、teams、owner-review、details、rules、developer-docs
  `dashboard/`：既有图表与 tooltip 模块（逻辑上属 components 层）
  `styles/app.css`：聚合 tokens、base、components、pages 样式；根目录 `styles.css` 仅作兼容重定向
  拆分方案与验收清单见 `./frontend-split-plan.md`；测试入口 `public/test-harness.mjs`

tests/
  后端行为测试。
```

## 开发流程

1. 先确认需求是否会改变系统边界。
2. 如果涉及数据读取、字段清洗、分页、安全脱敏，先写测试。
3. 修改后端模块。
4. 运行 `node --test`。
5. 如涉及前端，启动服务并用浏览器确认页面无控制台错误。
6. 如涉及真实钉钉数据，只输出同步摘要。
7. 更新对应文档。

## 文档同步规则

以后每一次开发都必须判断是否需要同步 Markdown 文档。判断标准：

- 改系统定位、数据权威链或钉钉导入契约：更新 `../contracts/data-authority.md`。
- 改安全策略、token、日志、同步保护：更新 `../contracts/security-boundary.md`。
- 改开发流程、测试方式、目录职责：更新本文档。
- 改 Git 跟踪范围、本地数据备份或 push 流程：更新 `./git-and-data.md`。
- 改启动、同步、缓存、排障或事故处理：更新 `./operations.md`。
- 改原始字段展示、字段格式化、动态列：更新 `../contracts/field-mapping.md`。
- 改指标、筛选、图表口径或 profile KPI：更新 `../contracts/dashboard-metrics.md`。
- 改人员主数据、责任身份或负责人路由：更新 `../contracts/personnel-and-responsibility-routing.md`。
- 改 Agent 快照或 API 契约：更新 `../contracts/agents-api.md`。
- 改规则口径、Deadline、提醒、延期判定：更新 `../rules/operational-rulebook.md`，并检查可执行规则与相关测试。
- 改架构决策：更新 `../contracts/decisions.md`。
- 改当前状态、待优化项、下一步计划：更新 `../STATUS.md`。

如果没有合适文档，不默认新建顶层 md。先判断类型：契约进 `../contracts/`，规则进 `../rules/`，探索稿、审查报告和执行计划进 `../archive/`，当前状态进 `../STATUS.md`。产品或页面设计只有仍在推进且需要多人协同时才进入主索引；废弃或已实现版本放 `../archive/page-specs/`。只有新的契约类型或长期维护入口，才新增主索引条目。

## 新功能进入主线的判定

允许进入主线：

- 新增筛选维度。
- 新增指标。
- 新增图表展示。
- 新增字段映射。
- 新增本地 SQLite 数据策略。
- 新增同步失败提示。
- 新增本地编辑接口，前提是只写 SQLite、保留审计、不写回钉钉。
- 新增导出摘要，前提是不包含敏感信息。

需要谨慎评审：

- 用户体系。
- 权限分层。
- 历史快照。
- 多表合并。
- 部署到公网。
- 数据导出。

禁止进入主线：

- 修改钉钉数据。
- 删除钉钉数据。
- 绕过审计直接修改本地最终数据。
- 在页面展示 token 或接口地址。

## 开发检查清单

- 是否仍然不写回钉钉。
- 是否没有新增钉钉写接口。
- 如有本地编辑，是否写入 SQLite 并保留审计。
- 是否没有把敏感信息写进前端。
- 是否有测试覆盖核心行为。
- 是否更新了文档。
- 是否把本次变化写入了 `../STATUS.md` 或相应专题文档。
- 是否可以用 `.env.example` 理解配置。
- 是否在真实数据调试时避免输出业务明细。
