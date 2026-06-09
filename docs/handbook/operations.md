# 运维与事故处理手册

## 本地启动

```powershell
node .\src\backend\server.mjs
```

默认端口由 `.env` 中的 `PORT` 控制。

## 健康检查

```powershell
Invoke-RestMethod http://localhost:4200/api/health
```

期望返回：

```json
{
  "ok": true
}
```

## 同步数据

同步必须通过后端执行，不允许前端直连钉钉。

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:4200/api/sync `
  -Headers @{ 'x-sync-key' = '<SYNC_API_KEY>' } `
  -Body '{"source":"dingtalk"}' `
  -ContentType 'application/json'
```

同步成功只应返回摘要：

```json
{
  "source": "dingtalk",
  "syncedAt": "2026-01-01T00:00:00.000Z",
  "totalRecords": 0
}
```

## 常用验证

```powershell
node --test
```

```powershell
Invoke-RestMethod http://localhost:4200/api/snapshot
```

```powershell
Invoke-RestMethod http://localhost:4200/api/metrics
```

## 本地数据文件

当前 JSON 缓存文件：

```text
data/dashboard-cache.json
```

当前主数据库文件：

```text
data/app.sqlite
```

维护规则：

- `data/dashboard-cache.json` 是历史阶段的钉钉本地快照，当前保留为兼容和回退线索。
- `data/app.sqlite` 是本地最终项目主数据文件。
- SQLite 中的 raw records 记录钉钉导入来源，projects 记录本地最终项目口径。
- 本地覆盖字段不能被后续钉钉同步静默覆盖。
- 本私人仓库为换机迁移便利，允许 `.env`、`data/`、`data/app.sqlite` 和看板缓存随仓库提交；若仓库将来转公开，必须先移除敏感文件、恢复常规 `.gitignore` 并轮换密钥。
- 如果缓存写入失败，先检查文件是否被占用、权限是否异常、服务进程是否重复启动。

## 重启服务

如果修改了后端代码或 `.env`，需要重启 Node 服务。

```powershell
Get-Process node
Stop-Process -Id <PID>
node .\src\backend\server.mjs
```

## 日常维护节奏

每日：

- 确认同步是否成功。
- 看 `totalRecords` 是否异常下降。
- 看前端页面是否能打开。

每周：

- 复查字段映射是否仍匹配钉钉表。
- 检查新增字段是否需要纳入指标。
- 检查延期和状态口径是否符合业务理解。
- 检查本地覆盖字段和钉钉来源差异是否需要处理。

每月：

- 复盘哪些指标真正被使用。
- 清理废弃字段和过时文档。
- 检查 `.env.example` 是否仍然完整。
- 检查安全墙文档是否需要更新。

## 常见问题

### token 获取失败

排查顺序：

1. token provider 是否可访问。
2. `.env` 中 token 配置是否存在。
3. 是否误把真实 token 写死到代码中。
4. 日志是否只显示脱敏错误。

### records/list 返回不完整

排查顺序：

1. `DINGTALK_PAGE_SIZE` 是否超过钉钉上限。
2. 是否正确处理 `hasMore`。
3. 是否把 `nextToken` 放入下一次请求体。
4. `DINGTALK_MAX_PAGES` 是否过小。

### 看板字段显示“未填写”

排查顺序：

1. 钉钉字段名是否变化。
2. `DINGTALK_FIELD_MAP_JSON` 是否需要更新。
3. 字段值是否从字符串变为对象或数组。
4. 清洗逻辑是否覆盖新结构。

### 本地值和钉钉值不一致

排查顺序：

1. 该字段是否已有本地覆盖记录。
2. `source_differences` 中是否存在待确认差异。
3. 本地最终口径是否应继续优先。
4. 是否需要接受钉钉最新值并记录差异处理结果。

## 事故分级

### S1：安全事故

典型情况：

- token 暴露到前端。
- AppSecret 被提交到不应暴露的位置。
- 日志出现完整 token。
- 未授权人员可以触发同步。
- 出现钉钉写入接口。

处理原则：立即停服务，优先止血，再排查。

### S2：数据完整性事故

典型情况：

- 同步只拉到部分分页。
- `hasMore=true` 但未继续请求。
- 字段映射错误导致指标大面积失真。
- 本地缓存或 SQLite 主库损坏。

处理原则：停止展示错误结论，恢复上一份可用数据或重新同步。

### S3：可用性事故

典型情况：

- 看板打不开。
- API 返回 500。
- 同步接口失败。
- 前端页面白屏。

处理原则：先恢复只读查询，再修复同步。

## 事故处理步骤

### S1 安全事故

1. 停止 Node 服务。
2. 撤销或更换已暴露的 token / secret。
3. 从代码、文档、日志、前端构建产物中删除敏感信息。
4. 扫描仓库和前端目录。
5. 检查日志脱敏逻辑。
6. 复盘为什么敏感信息越过安全墙。

### S2 数据事故

1. 确认 `/api/snapshot` 的 `totalRecords` 是否异常。
2. 检查最近一次同步时间。
3. 检查分页逻辑是否报错。
4. 检查钉钉字段名是否变化。
5. 重新同步。
6. 如果新数据仍异常，回退到上一份可信缓存或临时恢复 mock。

### S3 可用性事故

1. 调用 `/api/health`。
2. 查看 Node 进程是否存在。
3. 查看端口是否被占用。
4. 查看服务日志。
5. 运行 `node --test`。
6. 重启服务。

## 复盘模板

```md
# 事故复盘

## 时间

## 影响范围

## 现象

## 根因

## 处理过程

## 恢复时间

## 防止再发生

## 需要更新的文档或测试
```

## 永久改进要求

每一次事故都至少落一项长期改进：

- 增加测试。
- 增加文档。
- 增加配置校验。
- 增加日志脱敏。
- 增加监控检查。
- 删除危险能力。
