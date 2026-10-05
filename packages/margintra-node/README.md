# @margintra/node

Server-side TypeScript client for Margintra usage telemetry. Never expose an ingestion key in browser code.

```ts
import { Margintra } from '@margintra/node';
const margintra = new Margintra({ apiKey: process.env.MARGINTRA_API_KEY! });
await margintra.usage.recordOpenAI({
  externalRequestId: response.id,
  customerId: loggedInCustomer.externalId,
  model: response.model,
  feature: 'support-chat',
  usage: { inputTokens, outputTokens },
});
```

The client defaults to a 5-second request timeout and two retries. Configure these explicitly when needed:

```ts
const margintra = new Margintra({
  apiKey: process.env.MARGINTRA_API_KEY!,
  timeoutMs: 3_000,
  maxRetries: 2,
});
```

It retries only network failures, HTTP 429, and HTTP 5xx responses, using bounded exponential backoff with small jitter. It never retries ordinary 4xx responses such as 400, 401, 403, or 409.

## Privacy & SDK behavior

The SDK sends one HTTPS request only when `usage.record` or `usage.recordOpenAI` is called. The request contains only the documented usage fields explicitly supplied to that call; undeclared object properties are not serialized, and the SDK does not generate or infer usage metadata.

It does not inspect prompts, completions, environment variables, request headers, the filesystem, or any other application state. It has no background daemon, hidden telemetry, filesystem/database queue, or automatic instrumentation. It never writes application logs. API keys are used only in the `X-Margintra-Key` header and are redacted if a server ever echoes one in an error response.
