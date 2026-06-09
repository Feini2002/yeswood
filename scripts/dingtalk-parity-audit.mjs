#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getConfig } from '../src/backend/config.mjs';
import { openInitializedDatabase } from '../src/backend/database.mjs';
import { calculateTierKpis } from '../src/backend/metrics/calculators.mjs';
import { filterProjectsByProfile } from '../src/backend/metrics/scopes.mjs';
import { isSchemeDone, readSchemeStatus, readStoreTier, readStoreTierLabel } from '../src/backend/metrics/fieldSemantics.mjs';
import { readConfiguredPersonnelArchitecture } from '../src/backend/syncService.mjs';
import { databaseHasProjects, readSnapshotFromDatabase } from '../src/backend/projectRepository.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (item.startsWith('--')) {
      const [key, value] = item.slice(2).split('=');
      args[key] = value ?? true;
    }
  }
  return args;
}

function projectRow(project) {
  return {
    id: project.id,
    name: project.name,
    tier: readStoreTierLabel(project),
    owner: project.rawFields?.['负责人']?.display || project.owner,
    cdLead: project.rawFields?.['CD组长']?.display || '',
    vmLead: project.rawFields?.['VM组长']?.display || '',
    scheme: readSchemeStatus(project),
  };
}

function matchesKpi(project, kpi) {
  if (kpi === 'schemeDoneYtd') {
    return isSchemeDone(project);
  }
  return true;
}

async function loadCompareSet(comparePath) {
  if (!comparePath) {
    return null;
  }
  const raw = await fs.readFile(comparePath, 'utf8');
  const names = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const name = line.trim();
    if (name && name !== '项目名称') {
      names.add(name);
    }
  }
  return names;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = getConfig();
  if (!config.databaseFile) {
    console.error('DATABASE_FILE required');
    process.exit(1);
  }

  const database = openInitializedDatabase(config.databaseFile);
  try {
    const architecture = await readConfiguredPersonnelArchitecture(config);
    if (!databaseHasProjects(database)) {
      console.error('No projects in SQLite');
      process.exit(1);
    }
    const snapshot = readSnapshotFromDatabase(database, { personnelArchitecture: architecture });
    const projects = snapshot.projects || [];
    const profile = args.profile || 'ownerMonthly';
    const owner = args.owner || '';
    const tier = args.tier || 'regular';
    const kpi = args.kpi || 'schemeDoneYtd';
    const dashboardContext = args.context || 'franchise';

    const scoped = filterProjectsByProfile(projects, profile, {
      owner,
      team: { owner },
      dashboardContext,
      personnelArchitecture: architecture,
    });

    const tierScoped = scoped.filter((project) => readStoreTier(project) === tier);

    const included = tierScoped.filter((project) => matchesKpi(project, kpi)).map(projectRow);

    const compareNames = await loadCompareSet(args.compare);
    let onlySystem = [];
    let onlyDingtalk = [];
    if (compareNames) {
      const systemNames = new Set(included.map((row) => row.name));
      onlySystem = included.filter((row) => !compareNames.has(row.name));
      onlyDingtalk = Array.from(compareNames).filter((name) => !systemNames.has(name));
    }

    const kpis = calculateTierKpis(scoped, tier, {
      profileId: profile,
      dashboardContext,
    });

    console.log(
      JSON.stringify(
        {
          profile,
          owner,
          dashboardContext,
          tier,
          kpi,
          count: included.length,
          kpiValue: kpis[kpi],
          included,
          onlySystem,
          onlyDingtalk,
        },
        null,
        2
      )
    );
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
