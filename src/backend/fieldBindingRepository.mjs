function nowIso() {
  return new Date().toISOString();
}

export function readCachedFieldBindings(database) {
  const rows = database
    .prepare(
      `select canonical_key, source_field_key, match_method, confidence, last_seen_at
       from field_source_bindings
       order by canonical_key, last_seen_at desc`
    )
    .all();

  return rows.map((row) => ({
    canonicalKey: row.canonical_key,
    sourceFieldKey: row.source_field_key,
    matchMethod: row.match_method,
    confidence: Number(row.confidence ?? 1),
    lastSeenAt: row.last_seen_at,
  }));
}

export function saveFieldBindings(database, bindings = []) {
  const statement = database.prepare(
    `insert into field_source_bindings
      (canonical_key, source_field_key, match_method, confidence, last_seen_at)
     values (?, ?, ?, ?, ?)
     on conflict(canonical_key, source_field_key) do update set
       match_method = excluded.match_method,
       confidence = excluded.confidence,
       last_seen_at = excluded.last_seen_at`
  );

  const timestamp = nowIso();
  for (const binding of bindings) {
    statement.run(
      binding.canonicalKey,
      binding.sourceFieldKey,
      binding.matchMethod || 'auto',
      Number(binding.confidence ?? 1),
      binding.lastSeenAt || timestamp
    );
  }
}
