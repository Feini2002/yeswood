# 代码审查报告 — 2026-06-08

## 审查范围

对 `src/backend/` 下所有核心模块进行了全面审查，覆盖以下维度：

- **正确性**：空值/未定义引用、条件反转、边界条件、事务安全、SQL 注入
- **移除行为审计**：检查删除/替换代码的原有约束是否在新代码中重建
- **跨文件追踪**：函数签名变更对调用方的影响
- **语言陷阱**：JS falsy-zero、`==` 隐式转换、闭包捕获、时区问题
- **包装器/代理正确性**：缓存层、快照缓存的路由正确性
- **复用/简化/效率**：重复实现、冗余状态、不必要 I/O

---

## 🔴 高优先级 (确认 Bug)

### 1. `isOpenDelayed` 函数参数未使用，存在误导性签名

- **文件**: `src/backend/metrics/calculators.mjs:550`
- **问题**: 函数签名接受 `now` 和 `countClosedSchemeDelay` 参数，但函数体完全忽略它们，直接委托给 `isOpenDesignResponsibilityDelayed(project)`。
- **影响**: 调用方（如 `calculateDashboardMetrics` 中的 `riskProjects` 筛选）可能预期这些参数会影响行为，但实际上不会。如果未来有人传入不同的 `now` 或设置 `countClosedSchemeDelay=true`，行为不会改变，造成隐蔽的逻辑错误。
- **修复**: 如果这些参数确实不需要，应从签名中移除，或添加注释说明；如果未来需要，应实现相应逻辑。

```js
// 当前代码 (line 550-552)
export function isOpenDelayed(project, { now = new Date(), countClosedSchemeDelay = false } = {}) {
  return isOpenDesignResponsibilityDelayed(project);
}
```

### 2. `EFFICIENCY_FACTOR` 定义但未使用 — 负荷计算可能偏离预期

- **文件**: `src/backend/projectDifficulty.mjs:144-146`
- **问题**: `EFFICIENCY_FACTOR = 0.8` 被定义但从未在计算中使用。`ADJUSTMENT_FACTOR` 仅设为 `STARTUP_LOSS_FACTOR`（1.05），没有乘以效率系数。注释提到"不再把理想人力 8 折计入项目综合负荷"，说明效率系数被刻意移除。但 `EFFICIENCY_FACTOR` 常量仍保留在代码中，增加了维护者困惑。
- **影响**: 当前计算结果是正确的（按设计意图），但死代码可能让未来的维护者误用。
- **修复**: 移除未使用的 `EFFICIENCY_FACTOR` 常量，或在注释中明确说明为何保留。

### 3. `isSoftNotStarted` 中的 `includePause` 空值解引用风险

- **文件**: `src/backend/metrics/fieldSemantics.mjs:497-506`
- **问题**: 当 `includePause=true` 且 `stage` 为空字符串时，`SOFT_PAUSE_STAGES.some((item) => stage.includes(item))` 会在空字符串上调用 `.includes()`，虽然不会崩溃（空字符串的 includes 返回 false），但如果 `stage` 是 `null` 或 `undefined`（尽管 `readWorkflowStage` 始终返回字符串），则可能出错。
- **影响**: 当前 `readWorkflowStage` 始终返回字符串，所以不会触发。但缺乏防御性编程，属于代码健壮性问题。
- **修复**: 添加 `stage &&` 守卫。

---

## 🟡 中优先级 (潜在问题)

### 4. `backfillProjectOwnerColumns` 单列缺失时回填被跳过

- **文件**: `src/backend/database.mjs:367-371`
- **问题**: 条件 `if (!columns.has('cd_owner_text') || !columns.has('vm_owner_text'))` 使用 OR 逻辑——只要任一列缺失就返回。但 `ensureProjectOwnerColumns` 会分别添加缺失的列。如果数据库已有 `cd_owner_text` 但缺少 `vm_owner_text`，`ensureProjectOwnerColumns` 会添加 `vm_owner_text`，但 `backfillProjectOwnerColumns` 不会运行（因为 `cd_owner_text` 已存在）。**回填要等到下次启动才会执行。**
- **影响**: 新添加的列在首次启动时为空，需要重启服务才能完成回填。`backfillProjectProgressStageColumns` 存在相同问题。
- **修复**: 将 OR 改为 AND，或分别检查每列是否需要回填。

```js
// 当前 (line 369)
if (!columns.has('cd_owner_text') || !columns.has('vm_owner_text')) {
// 建议
if (!columns.has('cd_owner_text') && !columns.has('vm_owner_text')) {
```

### 5. `normalizeSnapshot` 中存在死代码

- **文件**: `src/backend/syncService.mjs:122-123`
- **问题**: `const newlyIgnoredRecords = cachedProjects.length - projects.length;` 计算结果始终为 0，因为 `canonicalProjects`（经过 `isValidProjectRecord` 过滤）和 `projects`（`enrichProjectsForDisplay` 的结果）的数量相同——`enrichProjectsForDisplay` 不做过滤，只添加展示信息。
- **影响**: 无功能影响，但造成代码阅读困惑。
- **修复**: 移除 `newlyIgnoredRecords` 变量或添加注释说明其用途。

### 6. `archiveProjectsMissingFromSnapshot` 在被忽略记录存在时跳过归档

- **文件**: `src/backend/projectRepository.mjs:333-336`
- **问题**: 当 `snapshot.ignoredRecords > 0` 时，函数直接返回，不归档任何项目。这意味着如果某次同步有无效记录（被忽略），已从 DingTalk 中删除的项目也不会被归档。这些项目会一直保持 `archived_at IS NULL` 状态。
- **影响**: 如果有持续的无效记录（例如数据源质量问题），项目永远不会被归档，导致数据库中积累大量已删除但未标记为归档的项目。
- **修复**: 考虑将归档逻辑与 `ignoredRecords` 解耦——无效记录不应阻止有效项目的归档判断。或者放宽条件为仅在 `ignoredRecords` 占比过高时跳过。

### 7. `resolveRiskHealthAnalysis` 每次 API 调用都打开/关闭数据库

- **文件**: `src/backend/server.mjs:469-497`
- **问题**: 每次 `/api/team-metrics` 请求都会新建数据库连接（`openInitializedDatabase`），执行读写操作后关闭。对于高频刷新的看板页面，这会产生大量连接开销。
- **影响**: 性能问题——在高并发场景下，频繁创建/销毁数据库连接会增加延迟。但由于使用了 SQLite WAL 模式，并发读取通常不是瓶颈。
- **修复**: 考虑在 server 生命周期内保持单个数据库连接，或使用连接池模式。

### 8. `snapshotCacheKey` 使用同步 I/O

- **文件**: `src/backend/syncService.mjs:36-43`
- **问题**: `fileVersion` 函数使用 `fs.statSync` 同步获取文件大小和修改时间，用于构造缓存键。`snapshotCacheKey` 在每次 `getSnapshot` 调用时都会执行。
- **影响**: 同步 I/O 会阻塞 Node.js 事件循环。虽然 `statSync` 通常很快，但在高负载下或网络文件系统上可能造成明显延迟。
- **修复**: 将 `fileVersion` 改为异步，或在缓存命中时跳过文件版本检查。

---

## 🟢 低优先级 (代码质量改进)

### 9. `cleanProjectRecord` 中 `crypto.randomUUID()` 作为 ID 回退值

- **文件**: `src/backend/projectData.mjs:404`
- **问题**: 当 `record.recordId`、`record.id`、`fields.recordId`、`fields.id` 全部为空时，使用 `crypto.randomUUID()` 生成 ID。这意味着同一条记录在两次 `cleanProjectRecord` 调用中可能得到不同的 ID。
- **影响**: 理论上可能导致重复导入。实践中 DingTalk 记录始终有 `recordId`，所以不太可能触发，但缺乏防御性。
- **修复**: 考虑基于记录内容（如名称+字段哈希）生成确定性 ID。

### 10. 时区处理不一致

- **文件**: 多处
- **问题**:
  - `isProjectDelayed` 使用 `new Date(\`${dueDate}T00:00:00\`)` → 本地时区
  - `normalizeDate` 使用 `Intl.DateTimeFormat` with `Asia/Shanghai` → 固定时区
  - `isInYear`/`isInMonth` 使用 `new Date(value)` → 取决于值的格式
- **影响**: 当服务器部署在非 Asia/Shanghai 时区时，日期比较可能产生一天的偏差。
- **修复**: 统一使用 `Asia/Shanghai` 时区进行所有日期计算，或在配置中明确服务器时区要求。

### 11. `enrichMetricsFromDatabase` 静默吞异常

- **文件**: `src/backend/projectRepository.mjs:527-529`
- **问题**: catch 块为空，仅注释说明"如果 responsibility 表为空则保留内存中的 personnel stats"。但异常可能由其他原因引起（如数据库损坏、SQL 错误），这些会被静默忽略。
- **影响**: 数据库异常不会产生任何日志或告警，难以排查问题。
- **修复**: 至少记录警告日志，并仅在特定异常（如表不存在）时回退。

### 12. `matchesDashboardContextFromRow` 每行执行 JSON.parse

- **文件**: `src/backend/responsibilityRepository.mjs:775-779`
- **问题**: 在 `listProjectsForOwnerSlot` 的 filter 回调中，每行都执行 `JSON.parse(row.raw_fields_json || '{}')`。对于大量项目，这会产生不必要的 JSON 解析开销。
- **影响**: 性能——对于数百个项目，每次过滤都重复解析 JSON。
- **修复**: 在 map 阶段解析一次，在 filter 阶段使用已解析的数据。

### 13. `PROJECT_DIFFICULTY_RULES` 中存在重复的 sortOrder 设置

- **文件**: `src/backend/projectDifficulty.mjs:134-140`
- **问题**: 规则数组先通过 `.map()` 设置 `sortOrder: index + 1`，但在 `database.mjs` 的 `seedProjectDifficultyRules` 中又使用 `rule.sortOrder`。而 `hardDecorationDeadlineRules.mjs` 中也可能有相关逻辑。重复的 sortOrder 来源容易混淆。
- **影响**: 维护困惑——不清楚 sortOrder 的权威来源。
- **修复**: 统一在一处管理 sortOrder，或明确注释说明优先级。

### 14. `readWorkflowStage` 对 hard 阶段的 progress 回退可能返回非阶段值

- **文件**: `src/backend/metrics/fieldSemantics.mjs:143-145`
- **问题**: 当硬装进度字段为空时，回退到 `progressFallbackStage(project.progress)`，该函数过滤掉纯数字/百分比的 progress 值返回空字符串，但可能让非标准文本通过。例如，如果 progress 字段包含非阶段文本（如"等待确认"），它会被当作阶段名称返回。
- **影响**: 非阶段的文本值可能被后续的阶段匹配逻辑（如 `isClosedStage`、`HARD_STAGE_AT_OR_AFTER_CONSTRUCTION_PATTERN`）误判。
- **修复**: 对 fallback 值添加更严格的验证，或仅在 progress 明确匹配已知阶段名称时才使用。

---

## 📊 审查统计

| 维度 | 发现数 |
|------|--------|
| 🔴 确认 Bug | 3 |
| 🟡 潜在问题 | 5 |
| 🟢 代码改进 | 6 |
| **总计** | **14** |

## 🔧 建议修复优先级

1. **立即修复**: 问题 #1 (`isOpenDelayed` 参数未使用) — API 签名与实际行为不符
2. **尽快修复**: 问题 #4 (回填跳过)、#6 (归档跳过) — 数据一致性风险
3. **计划修复**: 问题 #2、#3、#7、#8 — 代码质量和性能
4. **低优先级**: 问题 #9-#14 — 可在日常迭代中逐步优化

---

## ✅ 值得肯定的设计

以下设计决策和实现值得肯定：

- **SQL 参数化查询**: 所有 SQL 均使用 `?` 占位符，无 SQL 注入风险
- **事务安全**: `importSnapshotToDatabase` 和 `savePersonnelArchitectureToDatabase` 正确使用 BEGIN/COMMIT/ROLLBACK
- **数据库连接管理**: 所有数据库连接均使用 try/finally 确保关闭
- **快照缓存去重**: `getSnapshot` 中的 `snapshotCachePromise` 机制正确防止并发重复请求
- **WAL 模式**: SQLite 使用 WAL 日志模式，支持并发读取
- **规范化架构**: `normalizePersonnelArchitecture` 在多个入口点被调用，确保数据结构一致性
