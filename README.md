# 空间视觉项目中台

这是源木语空间视觉项目运营使用的本地数据中台。钉钉 AI 表格负责项目初始化录入和外部事实输入，本仓库负责把数据同步到本地 SQLite，清洗成项目主数据，计算运营指标，并提供桌面端看板与运营工作台。

> 私有仓库：[Feini2002/yeswood](https://github.com/Feini2002/yeswood)

## 仓库策略

这个仓库按“换电脑后 clone 即可继续开发，恢复本地数据后即可查看业务看板”的方式维护。

- 代码、文档、测试、脚本、规则数据和人员种子随仓库提交。
- `.env`、`data/app.sqlite`、`data/dashboard-cache.json`、日志、依赖和本地索引不进 Git。
- 新电脑安装 Node.js 并 clone 仓库后，复制本机备份的 `.env` 与 `data/app.sqlite`，或配置 `.env` 后重新同步灌库。
- 仓库虽然是私人仓库，仍按运行时数据和密钥不入库的策略维护。

完整 Git 与本地数据策略见 [`docs/handbook/git-and-data.md`](./docs/handbook/git-and-data.md)，安全边界见 [`docs/contracts/security-boundary.md`](./docs/contracts/security-boundary.md)。

## 快速开始

环境要求：Node.js LTS 或更新版本。

```powershell
git clone https://github.com/Feini2002/yeswood.git
cd yeswood
```

常用启动方式：

```powershell
# 开发模式：固定 4200 端口，保留热更新和页面自动刷新
.\开发模式-启动看板.bat

# 内网展示模式：固定 4300 端口，复制 public/data 快照，不启用热更新
.\内网展示-启动看板.bat

# 展示结束后清理内网快照目录
.\清理内网展示快照.bat

# 或直接启动后端
node .\src\backend\server.mjs
```

浏览器访问：

```text
http://localhost:4200
```

验证：

```powershell
node --test
```

## 当前能力

- 钉钉 AI 表格只读同步，不向钉钉写回数据。
- SQLite 本地主数据层，`data/app.sqlite` 是项目最终视图来源。
- 本地人员与责任槽配置，用于负责人、硬装、软装和协作关系分析。
- 总览、加盟看板、直营看板、小组情况、负责人复盘、项目情况等桌面端页面。
- 项目明细弹窗、项目 drill-down 列表、今日处理动作队列。
- 风险健康分析、部门团队运转 Agent、进店节奏分析、月度运转指标、项目负荷与难度计算。
- 自动化测试覆盖后端数据规则、指标计算、安全边界和关键前端结构。

## 数据权威顺序

```text
本地 SQLite 最终数据
> 本地覆盖规则
> 钉钉最新导入值
> 系统推导默认值
```

钉钉记录提供初始化和外部事实参考；本地项目主表提供最终展示、筛选和指标口径。本地覆盖字段不能被后续钉钉同步静默覆盖。

## 规则与文档入口

运营规则、Deadline 和延期提醒的人类可读正文见 [`docs/rules/operational-rulebook.md`](./docs/rules/operational-rulebook.md)。可执行矩阵与工作日计算以 `src/backend/hardDecorationDeadlineRules.mjs` 为准；前端规则一览页（`#rules`）只提供运营摘要。

业务背景与阶段语境见 [`公司情况与业务环境.md`](./公司情况与业务环境.md)。完整文档索引见 [`docs/README.md`](./docs/README.md)。

## 关键目录

| 路径 | 说明 |
| --- | --- |
| `public/` | 前端看板页面、样式和浏览器端模块 |
| `src/backend/` | 本地服务、同步、SQLite、指标计算和分析 Agent |
| `data/rules/` | Deadline 工作日和规则数据 |
| `data/personnel-database.json` | 人员种子与回退线索 |
| `docs/` | handbook、contracts、rules 和 archive 文档 |
| `tests/` | `node --test` 自动化测试 |
| `scripts/` | 数据诊断、校准、责任重建等维护脚本 |
| `.codex/` | 本仓库 Codex 技能与工作流配置 |
| `.codegraph/` | 本地可重建 CodeGraph 索引，不进 Git |

## API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/snapshot` | 数据快照元信息 |
| `GET` | `/api/filters` | 项目筛选项 |
| `GET` | `/api/projects` | 项目列表，支持 `search`、`province`、`owner`、`metric` 等查询 |
| `GET` | `/api/metrics` | 总览指标 |
| `GET` | `/api/dashboard-metrics` | 分 profile 指标 |
| `GET` | `/api/team-metrics` | 小组情况指标 |
| `POST` | `/api/sync` | 后台同步，使用 `x-sync-key` |
| `POST` | `/api/dashboard-sync` | 前端同源同步，需要 `DASHBOARD_SYNC_ENABLED=true` |

后台同步示例：

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:4200/api/sync `
  -Headers @{ 'x-sync-key' = $env:SYNC_API_KEY } `
  -Body '{"source":"dingtalk"}' `
  -ContentType 'application/json'
```

## 接入真实钉钉

`.env` 不进 Git。需要调整钉钉来源时，在本地 `.env` 中重点看这些变量：

```text
DINGTALK_MODE
DINGTALK_TOKEN_URL
DINGTALK_RECORDS_LIST_URL
DINGTALK_RECORDS_LIST_BODY_JSON
DINGTALK_TOKEN_AUTH_MODE
DINGTALK_ACCESS_TOKEN_HEADER
DINGTALK_FIELD_MAP_JSON
SYNC_API_KEY
DASHBOARD_SYNC_ENABLED
DASHBOARD_DEV_RELOAD
DASHBOARD_AUTO_UPDATE_ENABLED
PUBLIC_DIR
HOST
```

常用流程：

1. 确认 `.env` 中 `DINGTALK_MODE=dingtalk`。
2. 确认钉钉 token、records list 接口和请求体仍有效。
3. 启动本地服务。
4. 调用 `POST /api/sync`。
5. 刷新看板确认数据与指标。

## 常用命令

```powershell
# 启动
node .\src\backend\server.mjs

# 全量测试
node --test

# 查看 git 状态
git status --short

# 查看当前远程
git remote -v
```

## 重要文档

- 文档索引：[`docs/README.md`](./docs/README.md)
- 规则一览与延期提醒：[`docs/rules/operational-rulebook.md`](./docs/rules/operational-rulebook.md)
- 数据权威与钉钉导入契约：[`docs/contracts/data-authority.md`](./docs/contracts/data-authority.md)
- 指标与 Profile 契约：[`docs/contracts/dashboard-metrics.md`](./docs/contracts/dashboard-metrics.md)
- 人员与责任身份契约：[`docs/contracts/personnel-and-responsibility-routing.md`](./docs/contracts/personnel-and-responsibility-routing.md)
- 原始字段映射：[`docs/contracts/field-mapping.md`](./docs/contracts/field-mapping.md)
