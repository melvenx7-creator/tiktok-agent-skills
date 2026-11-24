import 'dotenv/config';

const env = process.env.SHOTSTACK_ENV || 'stage';
const key = process.env.SHOTSTACK_API_KEY;
if (!key || key === 'replace_me') {
  throw new Error('Missing SHOTSTACK_API_KEY. Copy .env.example to .env and add your key.');
}
if (!['stage', 'production'].includes(env)) {
  throw new Error('SHOTSTACK_ENV must be "stage" or "production".');
}

const baseUrl = env === 'production'
  ? 'https://api.shotstack.io/edit/v1'
  : 'https://api.shotstack.io/edit/stage';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': key,
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.response?.error || body?.error || body?.message || response.statusText;
    throw new Error(`Shotstack API ${response.status}: ${detail}`);
  }
  return body;
}

export async function submitRender(edit) {
  if (!edit || !edit.timeline || !edit.output) {
    throw new Error('Edit JSON must include timeline and output.');
  }
  return request('/render', { method: 'POST', body: JSON.stringify(edit) });
}

export async function getRenderStatus(renderId) {
  if (!renderId) throw new Error('A Shotstack render ID is required.');
  return request(`/render/${encodeURIComponent(renderId)}`);
}

export function currentEnvironment() { return env; }
