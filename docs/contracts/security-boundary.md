# 安全墙

## 安全原则

安全边界优先级高于功能便利性。任何让前端、浏览器、页面源码、控制台日志、网络请求暴露钉钉 token 或密钥的方案都不允许进入主线。

## 敏感信息范围

以下内容都视为敏感信息：

- access token。
- AppKey。
- AppSecret。
- token provider 地址。
- records/list 真实接口地址。
- operatorId、baseId、sheetId 等可定位真实业务数据源的参数。
- 同步接口密钥 `SYNC_API_KEY`。
- 本地 `.env` 文件内容。
- 从钉钉同步出的完整业务数据缓存。
- 本地 SQLite 数据库 `data/app.sqlite`。

## 存放规则

- 敏感信息只允许放在后端环境变量或本地 `.env`。
- `.env` 必须被 `.gitignore` 忽略，不得提交；`.env.example` 只允许放占位符、配置项说明和示例结构。
- `data/app.sqlite`、`data/dashboard-cache.json` 不得提交；换机时通过备份或同步恢复，见 [Git 与本地数据规范](../handbook/git-and-data.md)。
- 若仓库曾误提交敏感文件，必须从历史中移除并轮换所有密钥。
- 文档中只允许写配置项名称，不写真实 token 或真实密钥。
- 前端目录 `public/` 不允许出现任何钉钉 token、密钥或真实接口地址。

## 日志规则

- 日志中不得打印 token 原文。
- 日志中不得打印 AppSecret。
- 日志中不得打印完整 Authorization header。
- 生产日志只记录同步来源、同步条数、耗时、成功失败状态。
- 调试真实接口时只输出摘要，例如记录条数、分页次数、字段名结构，不输出完整业务明细。

## 接口规则

### 允许的后端接口

- 健康检查：`GET /api/health`
- 快照摘要：`GET /api/snapshot`
- 筛选选项：`GET /api/filters`
- 项目明细读取：`GET /api/projects`
- 指标读取：`GET /api/metrics`
- 受保护同步：`POST /api/sync`
- 后续本地编辑接口：只允许写入本地 SQLite，不允许写回钉钉。

### 禁止的后端接口

- 新增钉钉记录。
- 修改钉钉记录。
- 删除钉钉记录。
- 批量导入写回钉钉。
- 任何把前端请求转发为钉钉写操作的接口。

## 同步接口防护

`POST /api/sync` 必须满足：

- 要求 `x-sync-key`。
- 有最小触发间隔限制。
- 默认只允许后台人员或自动任务触发。
- 返回结果只包含同步摘要，不返回 token 或原始钉钉响应。

## 本地编辑接口防护

系统升级为 SQLite 本地主数据后，后续可以增加本地编辑接口。此类接口必须满足：

- 只修改 `data/app.sqlite` 中的本地项目主数据。
- 必须追加本地修改审计，不能只改主表不留痕。
- 不允许调用钉钉写入接口。
- 不允许把钉钉 token、AppSecret 或真实接口地址返回给前端。
- 低负载阶段可以先依赖部署环境限制访问；如果部署给多人使用，再增加登录和权限分层。

## 上线前安全检查

- 扫描 `public/`，确认没有 token、secret、真实钉钉接口地址。
- 扫描文档，确认没有真实 token。
- 检查接口列表，没有钉钉写入型 API；如有本地编辑 API，确认只写 SQLite 并保留审计。
- 检查浏览器网络请求，前端只访问本系统后端。
- 检查日志脱敏测试通过。
- 确认 `.env`、`data/app.sqlite`、`data/dashboard-cache.json` 未被 Git 跟踪。
- 确认敏感信息未在前端、日志或对外响应中泄露；若曾误提交须轮换密钥。

## 一票否决项

出现以下任一情况，必须停止发布：

- token 出现在前端代码中。
- token 出现在浏览器请求中。
- AppSecret 被写入仓库。
- 后端新增了钉钉写入接口。
- 本地编辑接口绕过审计直接改最终数据。
- 同步接口没有任何鉴权。
- 日志能看到完整 token 或 Authorization header。
