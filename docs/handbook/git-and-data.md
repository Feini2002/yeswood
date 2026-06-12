# Git 与本地数据规范

本文档记录仓库体积治理后的 Git 策略。权威忽略列表以根目录 `.gitignore` 为准。

## 背景

2026-06 曾将 `data/app.sqlite`（约 200MB+）多次提交进 Git，叠加中断提交产生的垃圾对象，使 `.git` 膨胀到约 34GB。实际业务代码与配置合计约几百 MB。

已执行：**删除旧 `.git`、重新 `git init`**，工作区文件（含未提交改动）保持不变。首次 push 待架构改造完成后再做。

## 什么应该进 Git

| 类别 | 路径 |
| --- | --- |
| 后端 | `src/backend/**` |
| 前端 | `public/**` |
| 测试 | `tests/**`、`tests/fixtures/**` |
| 文档与规格 | `docs/**`、`openspec/**`、`AGENTS.md`、`公司情况与业务环境.md` |
| 脚本与入口 | `scripts/**`、`*.bat`、`package.json` |
| 规则数据（权威、体积小） | `data/rules/**` |
| 人员种子 | `data/personnel-database.json` |
| 私有运行配置 | `.env` |
| 配置模板 | `.env.example` |
| 设计参考 | `UI参考/**` |
| 工程配置 | `.gitignore`、`.cursor/`、`.claude/` 等 |

`.env` 是当前私有仓库的明确例外：为了换机后 clone 即可恢复真实钉钉接入与同步配置，允许随仓库提交。仓库必须保持私有；若未来公开、转交无权限成员或迁移到非受控平台，必须先移除 `.env`、轮换其中所有密钥，并恢复常规密钥不入库策略。

## 什么不得进 Git

| 类别 | 路径 | 原因 |
| --- | --- | --- |
| 本地数据库 | `data/app.sqlite` | 运行时主数据，体积大、随同步变化 |
| 看板缓存 | `data/dashboard-cache.json` | 可重建的兼容快照 |
| 预计算读模型 | `data/precomputed/`、`data/read-model/` | 可重建运行时产物 |
| SQLite 旁路 | `data/*.sqlite-shm`、`data/*.sqlite-wal` | 运行时临时文件 |
| 工具索引与产物 | `.codegraph/`、`output/`、`.tmp/` | 本地可重建 |
| 依赖 | `node_modules/` | 标准排除 |
| 日志 | `*.log`、`*.err.log`、`*.out.log` | 排障产物 |

不得使用 `git add -f` 强行添加上表中的路径。

## 换机 / 新 clone 后如何恢复数据

1. `git clone` 得到代码、规则 JSON、人员种子和 `.env`。
2. 复制本机备份的 `data/app.sqlite`，或直接使用仓库内 `.env` 执行同步灌库。
3. `npm test` 与启动看板脚本验证。

`data/personnel-database.json` 仅在空库时作种子；日常以 SQLite `personnel_*` 表为准。

## 首次 push 清单（架构改完后执行）

1. 确认 `git status` 中**没有** `data/app.sqlite`、`data/dashboard-cache.json`、`data/precomputed/`、`data/read-model/`。
2. `npm test` 通过。
3. 首次提交：`git add` → `git commit`。
4. 关联远程并覆盖旧历史（仅首次需要 force）：

```powershell
git remote add origin https://github.com/Feini2002/yeswood.git
git branch -M main
git push -u origin main --force
```

5. 在另一目录 `git clone` 验证体积正常（应远小于旧仓库的 34GB）。
6. 确认 clone 后 `.env` 已存在，按上一节恢复或重建数据库即可运行。

## 日常开发

```text
改代码 → git add → git commit → git push
```

大文件已被 `.gitignore` 排除，正常 `git add .` 不会误纳入运行时数据。

## 相关文档

- 安全边界：`../contracts/security-boundary.md`
- 数据权威：`../contracts/data-authority.md`
- SQLite 设计：`../archive/2026-05-28-sqlite-local-master-data-design.md`
