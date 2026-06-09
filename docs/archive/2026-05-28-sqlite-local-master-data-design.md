# SQLite 本地主数据架构升级设计

## 背景

当前系统已经完成真实钉钉 AI 表格读取、分页同步、本地 JSON 缓存、字段清洗、指标 API 和静态前端看板。随着人员主数据和项目本地口径逐步出现，系统定位已经不再适合继续停留在“只读缓存看板”。

新的业务判断是：

- 钉钉 AI 表格负责初始化录入和外部事实输入。
- 本地系统负责完整项目主数据和最终业务口径。
- 本地可以覆盖项目状态、风险、负责人归属、进度口径、备注等字段。
- 本地修改不写回钉钉。
- 系统低负载、少数人员使用，不需要复杂多人协作、审批流或重型数据库服务。

因此本次升级选择 SQLite 作为本地主库，把钉钉同步结果作为导入源，把前端和 API 的读取口径迁移到本地最终数据视图。

## 目标

1. 建立 `data/app.sqlite` 作为本地最终数据源。
2. 保留钉钉原始记录，支持追溯每次导入来源。
3. 建立本地项目主表，支撑后续编辑和运营维护。
4. 建立字段覆盖和修改审计结构，避免钉钉再次同步时静默覆盖本地人工口径。
5. 保持现有读取 API 兼容，让当前前端先能继续工作。
6. 为后续项目台账、字段配置、人员维护、项目详情等前端升级预留稳定接口。

## 非目标

- 不写回钉钉。
- 不在本阶段设计完整前端工作台。
- 不引入复杂登录、审批流、多人锁或权限矩阵。
- 不迁移到 Postgres、MySQL 或云数据库。
- 不一次性重构所有 UI，只保证后续前端可以建立在 SQLite 最终视图上。

## 架构定位

```text
钉钉 AI 表格
  -> 后端同步导入器
  -> SQLite 原始导入层
  -> SQLite 本地项目主数据层
  -> SQLite 覆盖 / 差异 / 审计层
  -> 最终项目视图 API
  -> 当前看板与后续运营工作台
```

系统权威关系：

```text
本地 SQLite 最终数据 > 本地覆盖规则 > 钉钉最新导入值 > 系统推导默认值
```

钉钉不再被描述为唯一录入入口，而是“导入源 / 初始化来源 / 外部事实参考”。本地 SQLite 是最终项目主数据源。

## 技术选择

当前运行环境为 Node.js v24.14.0，可以使用 `node:sqlite` 的 `DatabaseSync`。该能力仍带 experimental warning，因此数据库访问必须封装在独立模块中，避免业务代码直接依赖具体实现。

推荐模块边界：

```text
src/backend/database.mjs
  打开 SQLite、初始化 schema、执行 migrations

src/backend/projectRepository.mjs
  读写 projects、overrides、change logs、最终项目视图

src/backend/dingtalkImportRepository.mjs
  写入 sync_runs、dingtalk_raw_records、source_differences

src/backend/sqliteProjectData.mjs
  计算筛选、指标、字段目录需要的最终项目结构

src/backend/syncService.mjs
  保持同步入口，但写入 SQLite 而不是 JSON 快照
```

后续如果需要换成 `better-sqlite3` 或 Postgres，只替换数据库模块和 repository 层，不让前端 API 和业务计算层直接感知。

## 数据库文件

默认路径：

```text
data/app.sqlite
```

维护规则：

- `data/app.sqlite` 是本地业务数据文件，不提交仓库。
- `data/dashboard-cache.json` 在迁移完成后只作为历史兼容或临时回退，不再是主数据源。
- `data/personnel-database.json` 可在第一阶段保留，后续再迁移到 SQLite 的 `personnel` / `teams` 表。

## 表结构设计

### `schema_migrations`

记录数据库 schema 版本。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| version | integer | migration 版本 |
| name | text | migration 名称 |
| applied_at | text | 执行时间 |

### `sync_runs`

记录每次导入。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 同步批次 id |
| source | text | `dingtalk` / `mock` / `json-seed` |
| status | text | `running` / `success` / `failed` |
| started_at | text | 开始时间 |
| finished_at | text | 完成时间 |
| source_records | integer | 来源记录数 |
| imported_records | integer | 导入到项目主表的数量 |
| ignored_records | integer | 忽略数量 |
| error_summary | text | 错误摘要 |

### `dingtalk_raw_records`

保存钉钉原始记录。它是来源证据，不是最终项目视图。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 本地 raw id |
| sync_run_id | text | 对应 `sync_runs.id` |
| dingtalk_record_id | text | 钉钉 record id |
| raw_json | text | 钉钉完整记录 JSON |
| raw_fields_json | text | `record.fields` JSON |
| field_hash | text | 字段内容 hash，用于判断变化 |
| source_created_time | text | 钉钉创建时间 |
| source_modified_time | text | 钉钉修改时间 |
| imported_at | text | 导入时间 |

索引：

```text
idx_raw_records_record_id(dingtalk_record_id)
idx_raw_records_sync_run(sync_run_id)
```

### `projects`

本地项目主表，是最终展示和指标的主来源。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 本地项目 id |
| dingtalk_record_id | text | 来源钉钉记录 id，可为空 |
| name | text | 项目名称 |
| province | text | 省份 |
| business_type | text | 业态 |
| store_status | text | 店态 |
| status | text | 本地最终项目状态 |
| owner_text | text | 本地最终负责人显示值 |
| progress | integer | 本地最终进度 |
| start_date | text | 启动日期 |
| due_date | text | 计划开业时间 / 计划完成日期（管理边界） |
| risk_level | text | 本地最终风险等级 |
| risk_notes | text | 本地最终风险说明 |
| local_notes | text | 本地备注 |
| source_updated_at | text | 钉钉来源更新时间 |
| local_updated_at | text | 本地更新时间 |
| created_at | text | 本地创建时间 |
| archived_at | text | 本地归档时间 |

唯一约束：

```text
unique(dingtalk_record_id)
```

### `project_field_overrides`

记录字段级本地覆盖。只要字段在这里出现，就不能被钉钉同步静默覆盖。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| project_id | text | 本地项目 id |
| field_key | text | 本地字段 key，例如 `status` / `risk_level` |
| local_value_json | text | 本地覆盖值 |
| source_value_json | text | 覆盖时的钉钉来源值 |
| value_type | text | `string` / `number` / `date` / `json` |
| reason | text | 覆盖原因 |
| edited_by | text | 编辑人，第一阶段可固定为 `local-admin` |
| updated_at | text | 更新时间 |

唯一约束：

```text
unique(project_id, field_key)
```

### `source_differences`

记录“钉钉最新值”和“本地最终值”不一致且需要人工确认的情况。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 差异 id |
| project_id | text | 本地项目 id |
| field_key | text | 字段 key |
| source_value_json | text | 钉钉最新值 |
| local_value_json | text | 本地最终值 |
| status | text | `open` / `accepted_source` / `kept_local` / `ignored` |
| detected_at | text | 发现时间 |
| resolved_at | text | 处理时间 |

### `project_change_logs`

记录本地项目变更。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | 日志 id |
| project_id | text | 本地项目 id |
| field_key | text | 字段 key |
| old_value_json | text | 旧值 |
| new_value_json | text | 新值 |
| change_type | text | `import` / `local_edit` / `conflict_resolution` |
| changed_by | text | 操作人 |
| changed_at | text | 操作时间 |
| note | text | 说明 |

### `field_aliases`

维护钉钉原始字段到前端专业展示名的映射。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| source_field_key | text | 钉钉原始字段 key |
| display_label | text | 前端展示 label |
| field_group | text | 字段分组 |
| is_core | integer | 是否核心字段 |
| is_visible_default | integer | 默认是否展示 |
| sort_order | integer | 排序 |
| updated_at | text | 更新时间 |

### `personnel` 与 `teams`

第一阶段可以继续读取 `data/personnel-database.json`，但 schema 预留如下方向：

```text
personnel
  id, name, display_name, position, discipline, status, aliases_json, source, updated_at

teams
  id, owner_person_id, cd_leads_json, vm_leads_json, updated_at
```

迁移人员主数据不阻塞本次 SQLite 项目主库升级。

## 同步合并规则

### 首次导入

1. 创建 `sync_runs`。
2. 写入每条 `dingtalk_raw_records`。
3. 根据字段映射和清洗规则创建 `projects`。
4. 对导入字段追加 `project_change_logs`，`change_type=import`。
5. 重新生成 API 需要的最终项目结构。

### 后续导入

对每条钉钉记录按 `dingtalk_record_id` 查找本地项目。

如果项目不存在：

```text
创建本地 projects
写入 raw record
追加 import 日志
```

如果项目已存在：

```text
写入新的 raw record
逐字段比较来源值和本地值
```

字段合并规则：

- 字段没有本地覆盖：允许用钉钉最新值更新 `projects`。
- 字段已有本地覆盖：不自动覆盖 `projects`。
- 字段已有本地覆盖且钉钉值发生变化：写入或更新 `source_differences`。
- 钉钉记录消失：不删除本地项目，先标记来源缺失或保留在差异队列。

### 本地编辑

后续前端编辑时：

1. 写入 `projects` 的最终字段。
2. 写入或更新 `project_field_overrides`。
3. 追加 `project_change_logs`，`change_type=local_edit`。
4. 不调用任何钉钉写接口。

## API 兼容策略

第一阶段保持现有读取 API 形状：

- `GET /api/health`
- `GET /api/snapshot`
- `GET /api/filters`
- `GET /api/projects`
- `GET /api/metrics`
- `POST /api/sync`
- `POST /api/dashboard-sync`

变化点：

- `/api/projects` 从 SQLite 最终项目视图读取，不再直接读取 JSON 快照。
- `/api/metrics` 基于 SQLite 最终项目视图计算。
- `/api/snapshot` 返回 `storage: sqlite`、`databaseReady: true` 等摘要字段。
- `readOnly` 文案后续应改为 `localEditable` 或移除，避免继续误导系统定位。

第一阶段不必须开放项目编辑 API，但 schema 和 repository 要支持后续增加：

```text
PATCH /api/projects/:id
PATCH /api/projects/:id/fields/:fieldKey
GET /api/projects/:id/changes
GET /api/source-differences
POST /api/source-differences/:id/resolve
```

## 前端策略

本次数据库升级不做前端大改版。当前页面可以继续展示总览、延期风险、人员情况和项目明细。

最低兼容要求：

- 现有页面仍能加载。
- 当前筛选、搜索、指标和明细表不因 SQLite 迁移失效。
- 后续再把“只读展示”“钉钉只读数据”等文案改为“本地主数据”“钉钉导入源”。

后续前端升级应围绕本地最终数据设计，而不是继续围绕钉钉原始字段宽表设计。

## 安全边界

继续保持：

- 前端不接触钉钉 token。
- 前端不调用钉钉接口。
- 后端不实现钉钉新增、编辑、删除、写回。
- 同步接口仍需保护。

新的边界：

- 本地编辑 API 允许修改 SQLite，但不允许写回钉钉。
- `data/app.sqlite` 视为业务数据文件，不提交仓库。
- 本地修改审计必须保留，不能只改主表不留痕。

## 测试范围

第一阶段至少覆盖：

1. SQLite schema 初始化成功。
2. migration 可重复执行且幂等。
3. 首次导入钉钉记录会创建 raw records 和 projects。
4. 后续导入会更新未覆盖字段。
5. 后续导入不会覆盖已有本地 override 的字段。
6. source value 变化且本地已覆盖时会生成 `source_differences`。
7. `/api/projects`、`/api/metrics` 继续返回当前前端需要的结构。
8. `node --test` 全量通过。

## 迁移步骤

1. 新增 SQLite 数据库模块和 schema migrations。
2. 新增 repository 层。
3. 改造同步服务，把导入结果写入 SQLite。
4. 改造读取服务，从 SQLite 最终项目视图生成现有 API 响应。
5. 保留 JSON 读取作为短期回退或测试 fixture。
6. 更新文档和测试。
7. 确认当前前端仍可打开并读取 506 条项目记录。

## 设计确认结论

本次系统升级采用“方案 2：SQLite 本地主库 + 钉钉导入源 + 覆盖/审计层”。这条路线符合当前少数人员、低负载、本地编辑、不写回钉钉的业务现实，也为后续前端运营工作台打下稳定底座。
