import assert from 'node:assert/strict';
import test from 'node:test';
import { Margintra } from '../client.js';
import { MargintraError } from '../error.js';

const ok = () => new Response(JSON.stringify({ accepted: true, duplicate: false, usageEventId: 'u1', customerId: 'c1', cost: '0.001000', currency: 'USD', costSource: 'calculated', pricingVersion: 'v1' }), { status: 200, headers: { 'content-type': 'application/json' } });
const input = { externalRequestId: 'req_1', customerId: 'customer_1', provider: 'openai' as const, model: 'gpt-5', usage: { inputTokens: 1, outputTokens: 2 } };

test('sends the normalized body, base URL, and secret header', async () => {
  let captured: { url?: string; init?: RequestInit | undefined } = {};
  const client = new Margintra({ apiKey: 'mtr_live_public_secret', baseUrl: 'https://margin.example/', maxRetries: 0,
    fetch: async (url, init) => { captured = { url: String(url), init }; return ok(); } });
  await client.usage.record({ ...input, prompt: 'must-not-be-serialized' } as typeof input);
  assert.equal(captured.url, 'https://margin.example/api/v1/ingest/usage');
  assert.equal((captured.init?.headers as Record<string, string>)['X-Margintra-Key'], 'mtr_live_public_secret');
  const body = JSON.parse(String(captured.init?.body)) as Record<string, unknown>;
  assert.equal(body.provider, 'openai');
  assert.equal('prompt' in body, false);
  assert.equal('occurredAt' in body, false);
});

test('OpenAI helper supplies only normalized provider primitives', async () => {
  let provider = '';
  const client = new Margintra({ apiKey: 'secret', maxRetries: 0, fetch: async (_url, init) => { provider = JSON.parse(String(init?.body)).provider as string; return ok(); } });
  const { provider: omittedProvider, ...openAiInput } = input;
  void omittedProvider;
  await client.usage.recordOpenAI(openAiInput);
  assert.equal(provider, 'openai');
});

for (const status of [400, 401, 403, 409]) test(`does not retry HTTP ${String(status)}`, async () => {
  let calls = 0;
  const client = new Margintra({ apiKey: 'top-secret-value', maxRetries: 3, fetch: async () => { calls += 1; return new Response(JSON.stringify({ code: 'SAFE', detail: 'safe failure' }), { status }); } });
  await assert.rejects(client.usage.record(input), (error: unknown) => error instanceof MargintraError && error.status === status && !error.message.includes('top-secret-value'));
  assert.equal(calls, 1);
});

for (const status of [429, 503]) test(`retries transient HTTP ${String(status)}`, async () => {
  let calls = 0;
  const client = new Margintra({ apiKey: 'secret', maxRetries: 2, fetch: async () => { calls += 1; return calls === 1 ? new Response('{}', { status }) : ok(); } });
  await client.usage.record(input); assert.equal(calls, 2);
});

test('retries a network failure and succeeds on the next request', async () => {
  let calls = 0;
  const client = new Margintra({ apiKey: 'secret', maxRetries: 2, fetch: async () => {
    calls += 1; if (calls === 1) throw new Error('socket down'); return ok();
  } });
  await client.usage.record(input);
  assert.equal(calls, 2);
});

test('bounds terminal network retries and normalizes the error without key disclosure', async () => {
  let calls = 0;
  const client = new Margintra({ apiKey: 'never-print-this', maxRetries: 2, fetch: async () => { calls += 1; throw new Error('socket down'); } });
  await assert.rejects(client.usage.record(input), (error: unknown) => error instanceof MargintraError && error.code === 'MARGINTRA_NETWORK_ERROR' && !error.message.includes('never-print-this'));
  assert.equal(calls, 3);
});

test('defaults to exactly two retries', async () => {
  let calls = 0;
  const client = new Margintra({ apiKey: 'secret', fetch: async () => { calls += 1; throw new Error('offline'); } });
  await assert.rejects(client.usage.record(input), MargintraError);
  assert.equal(calls, 3);
});

test('aborts requests at configured timeout', async () => {
  const client = new Margintra({ apiKey: 'secret', timeoutMs: 5, maxRetries: 0, fetch: async (_url, init) => await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))) });
  await assert.rejects(client.usage.record(input), (error: unknown) => error instanceof MargintraError && error.code === 'MARGINTRA_NETWORK_ERROR');
});

test('redacts an API key echoed by a server and never writes logs', async () => {
  const apiKey = 'mtr_live_do_not_expose';
  let logCalls = 0;
  const originalLog = console.log; const originalError = console.error;
  console.log = () => { logCalls += 1; }; console.error = () => { logCalls += 1; };
  try {
    const client = new Margintra({ apiKey, maxRetries: 0, fetch: async () =>
      new Response(JSON.stringify({ code: `KEY_${apiKey}`, detail: `Rejected credential ${apiKey}` }), { status: 401 }) });
    await assert.rejects(client.usage.record(input), (error: unknown) =>
      error instanceof MargintraError && error.message.includes('[REDACTED]') &&
      !error.message.includes(apiKey) && !error.code.includes(apiKey));
  } finally { console.log = originalLog; console.error = originalError; }
  assert.equal(logCalls, 0);
});

test('rejects timeout and retry values that could create unbounded behavior', () => {
  assert.throws(() => new Margintra({ apiKey: 'secret', maxRetries: Number.POSITIVE_INFINITY }), /maxRetries/);
  assert.throws(() => new Margintra({ apiKey: 'secret', maxRetries: 11 }), /maxRetries/);
  assert.throws(() => new Margintra({ apiKey: 'secret', timeoutMs: 0 }), /timeoutMs/);
});
