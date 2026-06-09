import { AGENT_MODEL_NAME, buildAgentScope } from './agents/agentMetadata.mjs';

function json(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function readPreviousRiskItem(database, { owner, dashboardContext, dedupeKey }) {
  return database
    .prepare(
      `select first_seen_at, status, closed_at, close_reason
       from agent_risk_items
       where owner = ? and dashboard_context = ? and dedupe_key = ?
       order by last_seen_at desc
       limit 1`
    )
    .get(owner || '', dashboardContext || 'all', dedupeKey);
}

export function saveRiskHealthAnalysis(database, analysis, options = {}) {
  const createdAt = nowIso();
  const owner = analysis.owner || options.owner || '';
  const dashboardContext = analysis.dashboardContext || options.dashboardContext || 'all';
  const generatedAt = analysis.generatedAt || createdAt;

  database.exec('BEGIN');
  try {
    database
      .prepare(
        `insert into agent_analysis_runs
          (run_id, owner, dashboard_context, generated_at, prompt_version, prompt_hash,
           input_snapshot_hash, input_snapshot_json, summary_json, created_by, model_name, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(run_id) do update set
           owner = excluded.owner,
           dashboard_context = excluded.dashboard_context,
           generated_at = excluded.generated_at,
           prompt_version = excluded.prompt_version,
           prompt_hash = excluded.prompt_hash,
           input_snapshot_hash = excluded.input_snapshot_hash,
           input_snapshot_json = excluded.input_snapshot_json,
           summary_json = excluded.summary_json,
           created_by = excluded.created_by,
           model_name = excluded.model_name,
           created_at = excluded.created_at`
      )
      .run(
        analysis.runId,
        owner,
        dashboardContext,
        generatedAt,
        analysis.promptVersion || '',
        analysis.promptHash || '',
        analysis.inputSnapshotHash || '',
        json(analysis.inputSnapshot || {}),
        json(analysis.summary || {}),
        options.createdBy || 'manual_agent',
        options.modelName || 'manual',
        createdAt
      );

    database.prepare('delete from agent_risk_items where run_id = ?').run(analysis.runId);
    const insertRiskItem = database.prepare(
      `insert into agent_risk_items
        (risk_item_id, run_id, dedupe_key, owner, dashboard_context, category, severity, confidence,
         title, impact_count, reasoning, recommended_action, evidence_json, related_project_ids_json,
         status, first_seen_at, last_seen_at, closed_at, close_reason)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const item of analysis.riskItems || []) {
      const previous = readPreviousRiskItem(database, {
        owner,
        dashboardContext,
        dedupeKey: item.dedupeKey,
      });
      const firstSeenAt = previous?.first_seen_at || generatedAt;
      const status = previous?.status && previous.status !== 'closed' ? previous.status : item.status || 'open';
      insertRiskItem.run(
        item.riskItemId,
        analysis.runId,
        item.dedupeKey,
        owner,
        dashboardContext,
        item.category || '',
        item.severity || 'P3',
        Number(item.confidence || 0),
        item.title || '',
        Number(item.impactCount || 0),
        item.reasoning || '',
        item.recommendedAction || '',
        json(item.evidence || []),
        json(item.relatedProjectIds || []),
        status,
        firstSeenAt,
        generatedAt,
        previous?.closed_at || null,
        previous?.close_reason || ''
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  return analysis;
}

function riskItemFromRow(row) {
  return {
    riskItemId: row.risk_item_id,
    runId: row.run_id,
    dedupeKey: row.dedupe_key,
    owner: row.owner,
    dashboardContext: row.dashboard_context,
    category: row.category,
    severity: row.severity,
    confidence: Number(row.confidence || 0),
    title: row.title,
    impactCount: Number(row.impact_count || 0),
    reasoning: row.reasoning,
    recommendedAction: row.recommended_action,
    evidence: parseJson(row.evidence_json, []),
    relatedProjectIds: parseJson(row.related_project_ids_json, []),
    status: row.status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    closedAt: row.closed_at || '',
    closeReason: row.close_reason || '',
  };
}

export function readLatestRiskHealthAnalysis(database, { owner = '', dashboardContext = 'all' } = {}) {
  const run = database
    .prepare(
      `select *
       from agent_analysis_runs
       where owner = ? and dashboard_context = ?
       order by generated_at desc, created_at desc
       limit 1`
    )
    .get(owner, dashboardContext);

  if (!run) {
    return null;
  }

  const riskItems = database
    .prepare(
      `select *
       from agent_risk_items
       where run_id = ?
       order by
         case severity when 'P1' then 1 when 'P2' then 2 else 3 end,
         impact_count desc,
         title`
    )
    .all(run.run_id)
    .map(riskItemFromRow);

  return {
    channel: 'riskHealth',
    agentName: '运营风险健康 Agent',
    runId: run.run_id,
    owner: run.owner,
    dashboardContext: run.dashboard_context,
    generatedAt: run.generated_at,
    promptVersion: run.prompt_version,
    promptHash: run.prompt_hash,
    inputSnapshotHash: run.input_snapshot_hash,
    inputSnapshot: parseJson(run.input_snapshot_json, {}),
    summary: parseJson(run.summary_json, {}),
    createdBy: run.created_by,
    modelName: run.model_name || AGENT_MODEL_NAME,
    analysisScope: buildAgentScope({
      owner: run.owner,
      dashboardContext: run.dashboard_context,
      channel: 'riskHealth',
    }),
    createdAt: run.created_at,
    riskItems,
  };
}
