export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD)$/i;

/** Values of environment variables that look like credentials. */
function collectSecrets(env) {
  return Object.entries(env)
    .filter(([name, value]) =>
      SECRET_NAME.test(name) &&
      typeof value === 'string' &&
      value.length >= 8 &&
      value !== 'replace_me')
    .map(([, value]) => value);
}

/**
 * Remove anything that looks like a credential from text that is about to be
 * logged or written to disk. Used on every error message.
 */
export function redact(text, env = process.env) {
  let out = String(text ?? '');
  for (const secret of collectSecrets(env)) out = out.split(secret).join('[redacted]');
  return out.replace(/sk-[A-Za-z0-9_-]{16,}/g, '[redacted]');
}

/** Run `fn` over `items` with at most `limit` calls in flight. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Retry with exponential backoff. `isRetryable(error)` decides whether to retry. */
export async function withRetry(fn, { retries = 3, baseMs = 1000, isRetryable = () => true } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      await sleep(baseMs * 2 ** attempt);
      attempt += 1;
    }
  }
}

export const round2 = (n) => Math.round(n * 100) / 100;
