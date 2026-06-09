import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPersonDisplayLookup,
  enrichProjectForDisplay,
  formatPersonnelDisplay,
} from '../src/backend/personnelDisplay.mjs';

const architecture = {
  people: {
    Jarvan范嘉瑞: {
      name: 'Jarvan范嘉瑞',
      displayName: '范嘉瑞',
      aliases: ['范嘉瑞', 'Jarvan'],
    },
  },
};

test('formatPersonnelDisplay maps canonical and alias names to displayName', () => {
  const lookup = buildPersonDisplayLookup(architecture);
  assert.equal(formatPersonnelDisplay('Jarvan范嘉瑞', lookup), '范嘉瑞');
  assert.equal(formatPersonnelDisplay('范嘉瑞', lookup), '范嘉瑞');
  assert.equal(formatPersonnelDisplay('陈立新, Jarvan范嘉瑞', lookup), '陈立新, 范嘉瑞');
  assert.equal(formatPersonnelDisplay('陈立营、Jarvan范嘉瑞', lookup), '陈立营、范嘉瑞');
});

test('enrichProjectForDisplay adds ownerDisplay and formats personnel raw fields', () => {
  const enriched = enrichProjectForDisplay(
    {
      owner: '王声祥, Jarvan范嘉瑞',
      cdOwner: '王声祥',
      vmOwner: 'Jarvan范嘉瑞',
      rawFields: {
        负责人: { display: '王声祥, Jarvan范嘉瑞' },
        CD负责人: { display: '王声祥' },
        VM负责人: { display: 'Jarvan范嘉瑞' },
        VM组长: { display: '张情、Jarvan范嘉瑞' },
      },
    },
    architecture
  );

  assert.equal(enriched.owner, '王声祥, 范嘉瑞');
  assert.equal(enriched.cdOwner, '王声祥');
  assert.equal(enriched.vmOwner, '范嘉瑞');
  assert.equal(enriched.ownerDisplay, '王声祥, 范嘉瑞');
  assert.equal(enriched.rawFields.负责人.display, '王声祥, 范嘉瑞');
  assert.equal(enriched.rawFields.CD负责人.display, '王声祥');
  assert.equal(enriched.rawFields.VM负责人.display, '范嘉瑞');
  assert.equal(enriched.rawFields.VM组长.display, '张情、范嘉瑞');
});
