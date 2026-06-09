import test from 'node:test';
import assert from 'node:assert/strict';

import { createDingTalkClient, fetchAllDingTalkRecords } from '../src/backend/dingtalkClient.mjs';

test('fetchAllDingTalkRecords follows nextToken until all pages are read', async () => {
  const calls = [];
  const pages = [
    { records: [{ recordId: 'p1' }], hasMore: true, nextToken: 'n2' },
    { records: [{ recordId: 'p2' }], hasMore: true, nextToken: 'n3' },
    { records: [{ recordId: 'p3' }], hasMore: false },
  ];

  const client = async ({ nextToken }) => {
    calls.push(nextToken ?? null);
    return pages.shift();
  };

  const records = await fetchAllDingTalkRecords({ listRecords: client });

  assert.deepEqual(records, [
    { recordId: 'p1' },
    { recordId: 'p2' },
    { recordId: 'p3' },
  ]);
  assert.deepEqual(calls, [null, 'n2', 'n3']);
});

test('fetchAllDingTalkRecords stops when hasMore is true but nextToken is missing', async () => {
  await assert.rejects(
    () =>
      fetchAllDingTalkRecords({
        listRecords: async () => ({ records: [], hasMore: true }),
      }),
    /nextToken/
  );
});

test('createDingTalkClient supports token provider url and DingTalk access token header', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });

    if (url === 'https://token.example.test/') {
      return new Response(JSON.stringify({ expireIn: 7200, accessToken: 'secret-token' }), { status: 200 });
    }

    return new Response(
      JSON.stringify({
        records: [{ recordId: 'rec-1' }],
        hasMore: true,
        nextToken: 'next-page-token',
      }),
      { status: 200 }
    );
  };

  const client = createDingTalkClient(
    {
      tokenUrl: 'https://token.example.test/',
      tokenMethod: 'GET',
      tokenAuthMode: 'none',
      recordsListUrl: 'https://api.dingtalk.com/v1.0/notable/bases/base/sheets/sheet/records/list?operatorId=operator',
      recordsMethod: 'POST',
      accessTokenHeader: 'x-acs-dingtalk-access-token',
      recordsRequestBody: {},
      pageSize: 100,
    },
    { fetchImpl }
  );

  const page = await client.listRecords({ nextToken: 'incoming-token', pageSize: 100 });

  assert.deepEqual(page, {
    records: [{ recordId: 'rec-1' }],
    hasMore: true,
    nextToken: 'next-page-token',
  });
  assert.equal(calls[0].url, 'https://token.example.test/');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[1].options.headers['x-acs-dingtalk-access-token'], 'secret-token');
  assert.equal(calls[1].options.headers.authorization, undefined);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    maxResults: 100,
    nextToken: 'incoming-token',
  });
});
