# OpenSpec 契约体系优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不迁移现有业务文档、不打断 P1/P2 开发的前提下，把当前系统的核心业务口径逐步沉淀为 OpenSpec 可校验契约。

**Architecture:** 保留 `docs/contracts/` 和 `docs/rules/` 作为人类可读权威说明；使用 `openspec/specs/` 保存可校验的能力级 SHALL/Scenario 基线；所有后续规则、指标、安全、数据权威或本地编辑变更先进入 `openspec/changes/<change-name>/`，实施完成后 archive 回主规格库。

**Tech Stack:** OpenSpec CLI、Node.js 原生测试 `node --test`、现有 Markdown 契约文档、现有后端/前端测试套件。

---

## 当前基线

```text
OpenSpec active changes: none
OpenSpec baseline specs:
  - frontend-architecture

Human-readable contracts:
  - docs/contracts/data-authority.md
  - docs/contracts/security-boundary.md
  - docs/contracts/field-mapping.md
  - docs/contracts/dashboard-metrics.md
  - docs/contracts/personnel-and-responsibility-routing.md
  - docs/contracts/agents-api.md
  - docs/contracts/decisions.md
  - docs/rules/operational-rulebook.md

Current development direction:
  - P1: business semantics and data authority stabilization
  - P2: local project operation workbench, local edits, field config, diff review
```

## 优化原则

- OpenSpec 只承接“会影响行为、边界、验收”的契约，不搬运普通说明文字。
- 现有 Markdown 文档不删除，继续负责业务语境、运营解释、历史背景和人类可读细节。
- 每个 OpenSpec spec 控制一个能力域，避免“大一统 contract”。
- 每个 spec 至少有一条可测试 Scenario，并链接到现有实现或测试。
- 先补高风险稳定口径，再给未来 P2 新能力开 change。
- 不为 OpenSpec 优化引入新 npm 依赖。

## 目标能力地图

| 优先级 | OpenSpec capability | 来源文档 | 主要代码/测试锚点 |
| --- | --- | --- | --- |
| 已有 | `frontend-architecture` | `docs/handbook/frontend-split-plan.md` | `public/app.js`、`public/test-harness.mjs`、`tests/frontendSplitPolicy.test.mjs` |
| P0 | `security-boundary` | `docs/contracts/security-boundary.md` | `src/backend/server.mjs`、`tests/security.test.mjs`、`tests/browserSync.test.mjs` |
| P0 | `data-authority` | `docs/contracts/data-authority.md` | `src/backend/syncService.mjs`、`src/backend/projectRepository.mjs`、`tests/syncService.test.mjs`、`tests/storage.test.mjs` |
| P0 | `field-mapping` | `docs/contracts/field-mapping.md` | `src/backend/fieldResolver.mjs`、`src/backend/projectData.mjs`、`tests/fieldResolver.test.mjs`、`tests/projectData.test.mjs` |
| P1 | `dashboard-metrics` | `docs/contracts/dashboard-metrics.md` | `src/backend/metrics/`、`tests/metrics/*.test.mjs`、`tests/teamMetrics.test.mjs` |
| P1 | `personnel-responsibility-routing` | `docs/contracts/personnel-and-responsibility-routing.md` | `src/backend/personnel*.mjs`、`src/backend/responsibility*.mjs`、`tests/personnel*.test.mjs`、`tests/responsibilityRepository.test.mjs` |
| P1 | `hard-decoration-deadlines` | `docs/rules/operational-rulebook.md` | `src/backend/hardDecorationDeadlineRules.mjs`、`tests/hardDecorationDeadlineRules.test.mjs`、`tests/rulesDocs.test.mjs` |
| P2 | `agent-api` | `docs/contracts/agents-api.md` | `src/backend/agents/`、`tests/agentWorker.test.mjs`、`tests/departmentOperationsAgent.test.mjs` |
| P2 | `local-editing-audit` | future change | `src/backend/projectRepository.mjs`、future local edit API tests |
| P2 | `source-diff-review` | future change | SQLite diff tables / future diff confirmation tests |

---

### Task 1: Establish OpenSpec governance routing

**Files:**
- Modify: `docs/handbook/development.md`
- Modify: `docs/STATUS.md`
- Test: OpenSpec CLI status and validation

- [x] **Step 1: Add OpenSpec gate policy to development handbook**

Add a short section to `docs/handbook/development.md` after the development flow:

```markdown
## OpenSpec 变更闸门

以下改动必须先创建 OpenSpec change，再进入实现：

- 改系统数据权威链、本地覆盖优先级或钉钉导入边界。
- 改安全边界、同步鉴权、日志脱敏或前端敏感信息暴露规则。
- 改字段映射、字段展示名、标准字段语义或字段清洗规则。
- 改 dashboard profile、KPI predicate、dateField、excludeRules 或责任 scope。
- 改人员主数据、责任身份、负责人路由或待核对通道。
- 改硬装 Deadline、提醒节点、延期判定或工作日日历规则。
- 新增本地编辑、差异确认、审计、导出或权限相关能力。

普通文案修正、错别字、非行为性说明补充可以只改 Markdown，不需要 OpenSpec change。
```

- [x] **Step 2: Add current OpenSpec baseline summary to status**

Add a short note to `docs/STATUS.md`:

```markdown
- OpenSpec 基线：当前已归档 `frontend-architecture`；下一批按 `security-boundary`、`data-authority`、`field-mapping`、`dashboard-metrics`、`personnel-responsibility-routing`、`hard-decoration-deadlines` 顺序补齐。
```

- [x] **Step 3: Verify OpenSpec state**

Run:

```powershell
openspec.cmd list --json
openspec.cmd list --specs --json
openspec.cmd validate --all
```

Expected:

```text
No active changes, or only the change currently being implemented.
Specs include frontend-architecture.
validate --all exits 0.
```

### Task 2: Seed P0 baseline specs for safety and data ingestion

**Files:**
- Create: `openspec/changes/seed-core-contract-specs/proposal.md`
- Create: `openspec/changes/seed-core-contract-specs/design.md`
- Create: `openspec/changes/seed-core-contract-specs/tasks.md`
- Create: `openspec/changes/seed-core-contract-specs/specs/security-boundary/spec.md`
- Create: `openspec/changes/seed-core-contract-specs/specs/data-authority/spec.md`
- Create: `openspec/changes/seed-core-contract-specs/specs/field-mapping/spec.md`
- Reference: `docs/contracts/security-boundary.md`
- Reference: `docs/contracts/data-authority.md`
- Reference: `docs/contracts/field-mapping.md`

- [x] **Step 1: Create the change**

Run:

```powershell
openspec.cmd new change "seed-core-contract-specs"
```

Expected:

```text
Created change 'seed-core-contract-specs'
```

- [x] **Step 2: Write `security-boundary` requirements**

Add these minimum requirements:

```markdown
## ADDED Requirements

### Requirement: Frontend never receives DingTalk secrets
The system SHALL keep DingTalk tokens, app secrets, sync keys, provider URLs, and real upstream API identifiers out of frontend source, browser responses, and browser requests.

#### Scenario: Static frontend contains no DingTalk secret
- **WHEN** frontend assets under `public/` are served to the browser
- **THEN** they MUST NOT contain DingTalk access tokens, AppSecret values, sync keys, or real upstream API endpoints

### Requirement: Backend does not expose DingTalk write APIs
The backend SHALL NOT provide API routes that create, update, delete, or batch-write DingTalk records.

#### Scenario: Local dashboard sync is read-only toward DingTalk
- **WHEN** a user triggers a sync or reads dashboard data
- **THEN** the backend MAY read DingTalk records and write local SQLite data
- **AND** it MUST NOT call a DingTalk write endpoint
```

- [x] **Step 3: Write `data-authority` requirements**

Add these minimum requirements:

```markdown
## ADDED Requirements

### Requirement: Local SQLite is final project data authority
The system SHALL treat local SQLite project data as the final project data source after DingTalk records are imported.

#### Scenario: Local override survives later sync
- **WHEN** a local final project field has been explicitly overridden
- **THEN** a later DingTalk sync MUST NOT silently overwrite that local value

### Requirement: DingTalk import handles pagination completely
The sync service SHALL read DingTalk records until `hasMore=false`.

#### Scenario: Missing next token fails sync
- **WHEN** DingTalk returns `hasMore=true` without `nextToken`
- **THEN** sync MUST fail visibly instead of silently dropping remaining records
```

- [x] **Step 4: Write `field-mapping` requirements**

Add these minimum requirements:

```markdown
## ADDED Requirements

### Requirement: Raw field keys remain source keys
The system SHALL preserve DingTalk raw field keys for import, raw record storage, and `rawFields` lookup.

#### Scenario: Display label does not change source mapping
- **WHEN** a frontend display label is shortened or professionalized
- **THEN** backend import and raw field lookup MUST continue to use the original DingTalk field key

### Requirement: Standard field mapping is explicit and diagnosable
The system SHALL resolve standard fields through environment overrides, cached bindings, or automatic field rules with ambiguity warnings instead of silent guessing.

#### Scenario: Ambiguous field mapping is reported
- **WHEN** multiple source fields match the same standard semantic field
- **THEN** the resolver MUST report ambiguity and avoid silently choosing an unsafe field
```

- [x] **Step 5: Validate and archive**

Run:

```powershell
openspec.cmd validate seed-core-contract-specs
openspec.cmd validate --all
```

Expected:

```text
Change 'seed-core-contract-specs' is valid
Totals: all items passed, 0 failed
```

After review and no code behavior changes required:

```powershell
openspec.cmd archive seed-core-contract-specs
openspec.cmd list --specs --json
openspec.cmd validate --all
```

Expected specs after archive:

```text
frontend-architecture
security-boundary
data-authority
field-mapping
```

### Task 3: Seed P1 metrics and responsibility specs

**Files:**
- Create: `openspec/changes/seed-metrics-responsibility-specs/*`
- Create: `openspec/changes/seed-metrics-responsibility-specs/specs/dashboard-metrics/spec.md`
- Create: `openspec/changes/seed-metrics-responsibility-specs/specs/personnel-responsibility-routing/spec.md`
- Reference: `docs/contracts/dashboard-metrics.md`
- Reference: `docs/contracts/personnel-and-responsibility-routing.md`

- [x] **Step 1: Create the change**

Run:

```powershell
openspec.cmd new change "seed-metrics-responsibility-specs"
```

- [x] **Step 2: Add `dashboard-metrics` minimum requirements**

Include these requirement names:

```text
Project status and workflow fields remain separate
Store tier and responsibility discipline are orthogonal
OwnerMonthly scope uses responsibility slots and dashboard context
Open delayed excludes closed design responsibility
MonthlyOps uses explicit stage date fields
```

- [x] **Step 3: Add `personnel-responsibility-routing` minimum requirements**

Include these requirement names:

```text
Local personnel architecture is organization authority
Responsibility identities use stable ids
Dual-discipline owners route by explicit slot
Team membership is not inferred from project collaboration
Unclear slot matches enter review channel
```

- [x] **Step 4: Validate against current tests**

Run:

```powershell
openspec.cmd validate seed-metrics-responsibility-specs
node --test tests/metrics/*.test.mjs tests/teamMetrics.test.mjs tests/personnelArchitecture.test.mjs tests/personnelOwners.test.mjs tests/responsibilityRepository.test.mjs
```

Expected:

```text
OpenSpec change is valid.
Node tests exit 0.
```

### Task 4: Seed hard decoration deadline spec

**Files:**
- Create: `openspec/changes/seed-hard-decoration-deadline-spec/*`
- Create: `openspec/changes/seed-hard-decoration-deadline-spec/specs/hard-decoration-deadlines/spec.md`
- Reference: `docs/rules/operational-rulebook.md`
- Reference: `src/backend/hardDecorationDeadlineRules.mjs`
- Test: `tests/hardDecorationDeadlineRules.test.mjs`
- Test: `tests/rulesDocs.test.mjs`

- [x] **Step 1: Create the change**

Run:

```powershell
openspec.cmd new change "seed-hard-decoration-deadline-spec"
```

- [x] **Step 2: Add minimum requirements**

Include these requirement names:

```text
Y plus N uses China workdays
DingTalk form delay result has final-status priority
System deadline fills missing form data
Floor plan deadline and efficiency are separate
Construction drawing process timeout and final delay remain separate
Rulebook and executable matrix stay synchronized
```

- [x] **Step 3: Validate with hard-decoration tests**

Run:

```powershell
openspec.cmd validate seed-hard-decoration-deadline-spec
node --test tests/hardDecorationDeadlineRules.test.mjs tests/rulesDocs.test.mjs tests/publicAppBehavior.test.mjs tests/brand-ui.test.mjs
```

Expected:

```text
OpenSpec change is valid.
All listed tests pass.
```

### Task 5: Define P2 change templates before local editing starts

**Files:**
- Create: `openspec/changes/add-local-editing-audit/proposal.md`
- Create: `openspec/changes/add-local-editing-audit/specs/local-editing-audit/spec.md`
- Create: `openspec/changes/add-source-diff-review/proposal.md`
- Create: `openspec/changes/add-source-diff-review/specs/source-diff-review/spec.md`

- [x] **Step 1: Create `local-editing-audit` change before building local edit APIs**

Run:

```powershell
openspec.cmd new change "add-local-editing-audit"
```

Minimum requirements:

```text
Local edits write only SQLite
Local edits append audit records
Local edits never write DingTalk
Local edits preserve source difference visibility
Malformed or unauthorized edit payloads fail safely
```

- [x] **Step 2: Create `source-diff-review` change before building diff confirmation UI**

Run:

```powershell
openspec.cmd new change "add-source-diff-review"
```

Minimum requirements:

```text
DingTalk and local final values can be compared
Conflicts enter an explicit review state
Review decisions do not mutate raw imported records
Accepted local decisions survive later sync
```

- [x] **Step 3: Do not archive these P2 changes before implementation**

Run:

```powershell
openspec.cmd list --json
```

Expected:

```text
add-local-editing-audit and add-source-diff-review remain in-progress until their implementation and tests are complete.
```

### Task 6: Add lightweight contract drift checks

**Files:**
- Create: `tests/openspecContracts.test.mjs`
- Modify: `package.json` only if a named script is later desired

- [x] **Step 1: Add a Node test that checks required baseline spec folders exist**

Create `tests/openspecContracts.test.mjs` with:

```javascript
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

const requiredSpecs = [
  'frontend-architecture',
  'security-boundary',
  'data-authority',
  'field-mapping',
  'dashboard-metrics',
  'personnel-responsibility-routing',
  'hard-decoration-deadlines',
];

test('required OpenSpec baseline specs exist after contract seeding', async () => {
  for (const name of requiredSpecs) {
    await access(join(root, 'openspec', 'specs', name, 'spec.md'));
  }
});

test('OpenSpec baseline specs use normative requirements and scenarios', async () => {
  for (const name of requiredSpecs) {
    const spec = await readFile(join(root, 'openspec', 'specs', name, 'spec.md'), 'utf8');
    assert.match(spec, /^### Requirement:/m, `${name} has requirements`);
    assert.match(spec, /^#### Scenario:/m, `${name} has scenarios`);
    assert.match(spec, /\bSHALL\b|\bMUST\b/, `${name} uses normative language`);
  }
});
```

- [x] **Step 2: Run the drift test only after the listed specs are seeded**

Run:

```powershell
node --test tests/openspecContracts.test.mjs
```

Expected:

```text
2 tests pass, 0 fail
```

### Task 7: Establish completion checkpoint

**Files:**
- Modify: `docs/STATUS.md`

- [x] **Step 1: Run full verification**

Run:

```powershell
openspec.cmd list --json
openspec.cmd list --specs --json
openspec.cmd validate --all
node --test
```

Expected:

```text
OpenSpec validates with 0 failed items.
Node test suite exits 0.
```

- [x] **Step 2: Add completion note to status**

Add:

```markdown
- OpenSpec 契约体系优化完成第一阶段：前端架构、安全边界、数据权威、字段映射、指标、人员责任、硬装 Deadline 已形成 baseline specs；未来 P2 本地编辑和差异确认必须先走 OpenSpec change。
```

## 完成定义

- `openspec/specs/` 至少包含：
  - `frontend-architecture`
  - `security-boundary`
  - `data-authority`
  - `field-mapping`
  - `dashboard-metrics`
  - `personnel-responsibility-routing`
  - `hard-decoration-deadlines`
- `openspec.cmd validate --all` 通过。
- 相关业务测试和全量 `node --test` 通过。
- `docs/handbook/development.md` 明确哪些变更必须先走 OpenSpec。
- P2 的本地编辑和差异确认未直接开工；它们有独立 active changes 或已完成归档。

## 暂不做

- 不把 `docs/contracts/` 全量搬进 OpenSpec。
- 不删除已有 Markdown 契约。
- 不为了 OpenSpec 加 CI、GitHub Action 或 npm 依赖；本地验证先够用。
- 不在同一个 change 里混合“补基线 specs”和“改业务行为”。
- 不把未确认的运营规则写成已生效 SHALL。
