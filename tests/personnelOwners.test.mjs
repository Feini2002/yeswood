import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { normalizePersonnelArchitecture } from '../src/backend/personnelArchitecture.mjs';
import {
  CREATIVE_OWNER_CATEGORY_LABEL,
  SOLE_DUAL_DISCIPLINE_OWNER_NAME,
  isSoleDualDisciplineOwner,
  resolveOwnerDisplayTitle,
} from '../src/backend/personnelOwners.mjs';

test('isSoleDualDisciplineOwner identifies the configured dual owner', () => {
  assert.equal(isSoleDualDisciplineOwner('杨锦帆'), true);
  assert.equal(isSoleDualDisciplineOwner('王吉祥'), false);
});

test('local personnel database records sole dual owner as creative lead', async () => {
  const database = JSON.parse(await readFile('data/personnel-database.json', 'utf8'));
  const architecture = normalizePersonnelArchitecture(database);
  const person = architecture.people[SOLE_DUAL_DISCIPLINE_OWNER_NAME];

  assert.equal(architecture.soleDualDisciplineOwner?.name, SOLE_DUAL_DISCIPLINE_OWNER_NAME);
  assert.equal(person.categoryLabel, CREATIVE_OWNER_CATEGORY_LABEL);
  assert.equal(person.dualDisciplineOwner, true);
  assert.equal(resolveOwnerDisplayTitle(person, architecture.categories), CREATIVE_OWNER_CATEGORY_LABEL);
  assert.deepEqual(
    Object.values(architecture.people).filter((item) => item.dualDisciplineOwner),
    [person]
  );
});
