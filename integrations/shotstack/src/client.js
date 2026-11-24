// Load a local .env if there is one. Uses dotenv when installed (as before) and
// falls back to Node's built-in loader, so the package also works without `npm install`.
try {
  await import('dotenv/config');
} catch {
  try {
    process.loadEnvFile?.();
  } catch {
    /* no .env file: variables come from the real environment (e.g. CI secrets) */
  }
}

const ENVIRONMENTS = {
  stage: {
    edit: 'https://api.shotstack.io/edit/stage',
    ingest: 'https://api.shotstack.io/ingest/stage'
  },
  production: {
    edit: 'https://api.shotstack.io/edit/v1',
    ingest: 'https://api.shotstack.io/ingest/v1'
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Read lazily so that importing this module never fails; errors appear when a call is made.
function settings() {
  const env = process.env.SHOTSTACK_ENV || 'stage';
  const key = process.env.SHOTSTACK_API_KEY;
  if (!key || key === 'replace_me') {
    throw new Error('Missing SHOTSTACK_API_KEY. Copy .env.example to .env and add your key.');
  }
  if (!ENVIRONMENTS[env]) {
    throw new Error('SHOTSTACK_ENV must be "stage" or "production".');
  }
  return { env, key, urls: ENVIRONMENTS[env] };
}

async function request(api, path, options = {}) {
  const { key, urls } = settings();
  const headers = { Accept: 'application/json', 'x-api-key': key, ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${urls[api]}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      body?.response?.error ||
      body?.error ||
      body?.message ||
      body?.errors?.[0]?.detail ||
      body?.errors?.[0]?.title ||
      response.statusText;
    throw new Error(`Shotstack API ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return body;
}

// ------------------------------------------------------------ Edit API

export async function submitRender(edit) {
  if (!edit || !edit.timeline || !edit.output) {
    throw new Error('Edit JSON must include timeline and output.');
  }
  return request('edit', '/render', { method: 'POST', body: JSON.stringify(edit) });
}

export async function getRenderStatus(renderId) {
  if (!renderId) throw new Error('A Shotstack render ID is required.');
  return request('edit', `/render/${encodeURIComponent(renderId)}`);
}

/**
 * Poll a render until it is done. Resolves with the `response` object (including `url`);
 * throws if the render fails or the timeout is reached.
 */
export async function waitForRender(renderId, { intervalMs = 10000, timeoutMs = 15 * 60 * 1000, onStatus } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = (await getRenderStatus(renderId))?.response ?? {};
    if (onStatus) onStatus(result.status);
    if (result.status === 'done') {
      if (!result.url) throw new Error('Shotstack reported the render as done but returned no URL.');
      return result;
    }
    if (result.status === 'failed') {
      throw new Error(`Shotstack render failed: ${result.error || 'no details returned'}`);
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for render ${renderId}.`);
    await sleep(intervalMs);
  }
}

/** The account's current model catalogue (see docs/shotstack-setup.md). */
export async function listModels() {
  return request('edit', '/models?expand=options');
}

// ------------------------------------------------------------ Ingest API

/**
 * Upload a file (Buffer) and resolve with a Shotstack-hosted URL usable in an Edit.
 * Flow: request a signed URL, PUT the raw bytes to it, then poll until the source is ready.
 */
export async function uploadAsset(data, { pollMs = 2000, timeoutMs = 3 * 60 * 1000 } = {}) {
  const created = await request('ingest', '/upload', { method: 'POST' });
  const id = created?.data?.id;
  const signedUrl = created?.data?.attributes?.url;
  if (!id || !signedUrl) throw new Error('Shotstack Ingest did not return an upload URL.');

  // The signed URL is a different host: never send the API key to it.
  const put = await fetch(signedUrl, { method: 'PUT', body: data });
  if (!put.ok) throw new Error(`Shotstack upload failed with status ${put.status}.`);

  return waitForSource(id, { pollMs, timeoutMs });
}

export async function waitForSource(sourceId, { pollMs = 2000, timeoutMs = 3 * 60 * 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = await request('ingest', `/sources/${encodeURIComponent(sourceId)}`);
    const source = body?.data?.attributes ?? body?.response ?? body ?? {};
    if (source.status === 'ready') {
      const url = source.source || source.url;
      if (!url) throw new Error('Shotstack reported the source as ready but returned no URL.');
      return url;
    }
    if (source.status === 'failed') {
      throw new Error(`Shotstack could not ingest the file: ${source.error || 'unknown error'}`);
    }
    if (Date.now() > deadline) throw new Error('Timed out waiting for Shotstack to ingest the file.');
    await sleep(pollMs);
  }
}

export function currentEnvironment() {
  return process.env.SHOTSTACK_ENV || 'stage';
}
