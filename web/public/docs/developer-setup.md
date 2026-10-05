# Margintra developer setup

This guide connects Stripe revenue and sends customer-level AI usage to a Margintra deployment.

## 1. Create a Stripe restricted key

In the Stripe Dashboard, open **Developers → API keys → Create restricted key**. Set these resources to **Read**:

- Accounts
- Customers
- Subscriptions
- Prices
- Products

Everything else can remain **None**. Margintra does not require Write permissions.

Copy the `rk_test_...` or `rk_live_...` key into **Margintra → Integrations → Stripe**. Margintra stores the credential encrypted and does not display it again.

## 2. Configure the Stripe webhook

In Stripe, open **Developers → Webhooks**, create an endpoint, and use the signed webhook URL shown under **Margintra → Integrations → Stripe → Advanced webhook settings**. The URL belongs to your Margintra deployment and has this shape:

```text
https://<your-margintra-domain>/api/v1/webhooks/stripe/<connection-identifier>
```

Subscribe the endpoint to the events Margintra currently processes:

- `customer.created`
- `customer.updated`
- `customer.deleted`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`
- `price.updated`
- `product.updated`

After creating the endpoint, reveal its Stripe signing secret (`whsec_...`) and enter it in **Advanced webhook settings** for that exact endpoint. Do not use a signing secret from another endpoint.

## 3. Send usage data

Create an ingestion key under **Margintra → Integrations → Usage API keys**. Copy it when it is created: the plaintext key is shown once, stored only as a hash, and cannot be recovered. Keep it in a server-side environment variable—never browser or frontend code.

Send one event at a time to:

```text
POST https://<your-margintra-domain>/api/v1/ingest/usage
```

`customerId` is the billing provider's native customer ID. For Stripe, send `cus_...`; the internal `stripe:` namespace is not part of the public ingestion contract.

### Node.js

```ts
import { Margintra } from '@margintra/node';

const margintra = new Margintra({
  apiKey: process.env.MARGINTRA_API_KEY!,
  baseUrl: process.env.MARGINTRA_API_URL,
});

await margintra.usage.recordOpenAI({
  externalRequestId: response.id,
  customerId: 'cus_123',
  model: response.model,
  feature: 'support-chat',
  usage: {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  },
  occurredAt: new Date().toISOString(),
});
```

### cURL

```bash
curl --request POST "${MARGINTRA_API_URL}/api/v1/ingest/usage" \
  --header "Content-Type: application/json" \
  --header "X-Margintra-Key: ${MARGINTRA_API_KEY}" \
  --data-raw '{
    "externalRequestId": "req_123",
    "customerId": "cus_123",
    "provider": "openai",
    "model": "gpt-5",
    "feature": "support-chat",
    "usage": {
      "inputTokens": 1200,
      "outputTokens": 300
    },
    "occurredAt": "2026-09-02T12:00:00.000Z"
  }'
```

Use a stable, unique `externalRequestId` for retries. Equivalent retries do not create another event; a materially different payload using the same ID returns a conflict.

## Troubleshooting

- **Missing Stripe permission:** Set the named Stripe resource to **Read**. Margintra checks Accounts, Customers, Subscriptions, Prices, and Products during connection.
- **Invalid Stripe key:** Confirm the value is the complete `rk_test_...` or `rk_live_...` restricted key and has not been deleted or rolled over in Stripe.
- **Invalid webhook secret:** Use the `whsec_...` secret from the exact Stripe endpoint configured for this Margintra connection.
- **`CUSTOMER_NOT_FOUND`:** Synchronize Stripe first and send the native Stripe customer ID (`cus_...`) belonging to the same Margintra organization.
- **`INVALID_API_KEY` or `API_KEY_REVOKED`:** Use an active Margintra ingestion key in the `X-Margintra-Key` header. Lost or revoked secrets cannot be recovered; create or rotate a key.
- **`DUPLICATE_REQUEST_CONFLICT`:** The `externalRequestId` was already accepted with materially different customer or usage facts. Generate a new request ID for a genuinely different event.
