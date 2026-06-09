function requireRealConfig(config) {
  const missing = [];
  if (!config.tokenUrl) missing.push('DINGTALK_TOKEN_URL');
  if (!config.recordsListUrl) missing.push('DINGTALK_RECORDS_LIST_URL');
  if ((config.tokenAuthMode || 'appsecret').toLowerCase() !== 'none') {
    if (!config.appKey) missing.push('DINGTALK_APP_KEY');
    if (!config.appSecret) missing.push('DINGTALK_APP_SECRET');
  }

  if (missing.length > 0) {
    throw new Error(`Missing DingTalk environment variables: ${missing.join(', ')}`);
  }
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned non-JSON response`);
  }

  if (!response.ok) {
    const message = data.message || data.errorMsg || data.error || response.statusText;
    throw new Error(`${label} failed: ${response.status} ${message}`);
  }

  return data;
}

function pickAccessToken(data) {
  return data.accessToken || data.access_token || data.token || data.result?.accessToken || data.result?.access_token;
}

function normalizeRecordsPage(data) {
  const source = data.result || data.data || data;
  return {
    records: Array.isArray(source.records) ? source.records : [],
    hasMore: Boolean(source.hasMore),
    nextToken: source.nextToken || source.next_token || '',
  };
}

export async function fetchAllDingTalkRecords({ listRecords, pageSize = 100, maxPages = 200 }) {
  const allRecords = [];
  let nextToken;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await listRecords({ nextToken, pageSize });
    const records = Array.isArray(result.records) ? result.records : [];
    allRecords.push(...records);

    if (!result.hasMore) {
      return allRecords;
    }

    if (!result.nextToken) {
      throw new Error('DingTalk records/list returned hasMore=true without nextToken');
    }

    nextToken = result.nextToken;
  }

  throw new Error(`DingTalk pagination exceeded maxPages=${maxPages}`);
}

export function createDingTalkClient(config, { fetchImpl = globalThis.fetch } = {}) {
  requireRealConfig(config);

  if (!fetchImpl) {
    throw new Error('fetch is not available in this Node runtime');
  }

  let cachedToken = '';

  async function fetchAccessToken() {
    if (cachedToken) {
      return cachedToken;
    }

    const method = config.tokenMethod || 'POST';
    const headers = { 'content-type': 'application/json' };
    const tokenAuthMode = (config.tokenAuthMode || 'appsecret').toLowerCase();
    let url = config.tokenUrl;
    let body;

    if (tokenAuthMode === 'none') {
      body = undefined;
    } else if (method === 'GET') {
      const tokenUrl = new URL(url);
      tokenUrl.searchParams.set('appKey', config.appKey);
      tokenUrl.searchParams.set('appSecret', config.appSecret);
      url = tokenUrl.toString();
    } else {
      body = JSON.stringify({
        appKey: config.appKey,
        appSecret: config.appSecret,
      });
    }

    const response = await fetchImpl(url, { method, headers, body });
    const data = await readJsonResponse(response, 'DingTalk accessToken');
    const token = pickAccessToken(data);
    if (!token) {
      throw new Error('DingTalk accessToken response did not include a token');
    }

    cachedToken = token;
    return token;
  }

  async function listRecords({ nextToken, pageSize }) {
    const token = await fetchAccessToken();
    const accessTokenHeader = config.accessTokenHeader || 'authorization';
    const tokenHeaders =
      accessTokenHeader.toLowerCase() === 'authorization'
        ? { authorization: `Bearer ${token}` }
        : { [accessTokenHeader]: token };
    const body = {
      ...config.recordsRequestBody,
      maxResults: pageSize || config.pageSize || 100,
    };

    if (nextToken) {
      body.nextToken = nextToken;
    }

    const response = await fetchImpl(config.recordsListUrl, {
      method: config.recordsMethod || 'POST',
      headers: {
        'content-type': 'application/json',
        ...tokenHeaders,
      },
      body: JSON.stringify(body),
    });

    const data = await readJsonResponse(response, 'DingTalk records/list');
    return normalizeRecordsPage(data);
  }

  return {
    fetchAccessToken,
    listRecords,
  };
}
