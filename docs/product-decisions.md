# Margintra product and technical decisions

This document is the canonical backlog for agreed product semantics and decisions that remain intentionally unresolved. Runtime behavior must not drift from approved decisions, and deferred items require an explicit product decision before implementation.

## 1. Approved current behavior

- **Subscription status and MRR:** `active` and `past_due` subscriptions count toward MRR. `trialing`, `incomplete`, `incomplete_expired`, `unpaid`, `paused`, and `canceled` subscriptions do not.
- **Scheduled cancellation:** A subscription with `cancel_at_period_end` remains counted while its status is `active`.
- **Past-due handling:** Margintra does not maintain a custom grace-period timer for `past_due` subscriptions.
- **Revenue meaning:** Revenue is subscription run-rate measured as period-end MRR. It is not collected cash, recognized accounting revenue, or invoice payment volume.
- **Usage customer identity:** The public `customerId` supplied during usage ingestion is the billing provider's native customer ID, such as Stripe `cus_...`. Internal provider prefixes are implementation details.
- **Ingestion key contract:** Before external launch, the canonical key prefix is `mtr_live_...` and the canonical ingestion header is `X-Margintra-Key`. The superseded `mos_live_...` format and `X-MarginOS-Key` header are intentionally not accepted.

## 2. Deferred improvements

### Effective revenue after Stripe discounts

- **Approved semantics:** List-price MRR and Effective MRR are distinct concepts. Effective MRR is the eligible fixed recurring subscription run-rate net of active recurring discounts that deterministically apply.
- **Excluded from Effective MRR:** Taxes, prorations, credits, customer balances, one-time charges, payment outcomes, and one-time coupons. One-time coupons do not reduce recurring MRR.
- **Currency:** Do not perform implicit FX conversion.
- **Unsupported cases:** Ambiguous metered, tiered, mixed-cadence, or amount-allocation cases remain unsupported rather than estimated.
- **Historical reproducibility:** Historical Effective MRR must retain enough discount provenance to reproduce and explain the calculated result.
- **Implementation status:** Deferred/pending.
- **Why deferred:** The approved semantics still require a safe Stripe data model, deterministic discount allocation, provenance persistence, and historical migration strategy before implementation.
- **Decision still required:** Define the implementation and migration strategy for introducing List-price MRR and Effective MRR without changing existing historical Revenue records.
- **Must not change accidentally:** Do not silently redefine existing historical Revenue semantics or subtract Stripe discounts from the current period-end MRR calculation before the pending implementation is approved.

### Metered and tiered billing revenue semantics

- **Approved fixed-MRR semantics:** Fixed MRR includes only deterministic fixed recurring commitments. Metered charges are not MRR and must not be projected or annualized. Mixed subscriptions preserve their supported fixed-MRR portion separately.
- **Approved historical semantics:** Historical metered revenue, if implemented, comes from finalized Stripe recurring metered invoice lines rather than payment success. It is billed revenue, not collected cash.
- **Metric separation:** Fixed MRR and metered billed revenue remain separately named metrics. Do not combine them into a generic Revenue metric until an explicit presentation and attribution policy is approved.
- **Open-period values:** Any future open-period metered value must be identified as provisional and include an as-of timestamp.
- **Currency:** Do not perform implicit FX conversion.
- **Implementation status:** Deferred/pending.
- **Why deferred:** Finalized invoice ingestion, correction handling, historical attribution, presentation, and migration behavior still require an approved implementation design.
- **Decision still required:** Define how finalized metered invoice lines are attributed to reporting periods and how the separate fixed-MRR and metered-billed-revenue metrics appear in profitability views.
- **Must not change accidentally:** Do not infer, estimate, project, annualize, or include metered/tiered charges in MRR, and do not silently merge billed metered revenue into the existing Revenue metric.

### FX conversion for multi-currency organizations

- **Approved reporting policy:** Each organization has one reporting currency. Margintra does not perform implicit FX conversion, and different currencies must never be silently summed.
- **Stripe normalization:** Stripe revenue in a different currency is excluded from profitability aggregation and must produce or retain a normalization warning.
- **Historical profitability:** Historical profitability uses only values already expressed in the organization reporting currency.
- **Implementation status:** Future FX support is deferred.
- **Historical reproducibility:** If FX conversion is implemented later, the applied historical exchange rate must be persisted with each derived value so the result remains reproducible.
- **Must not change accidentally:** Do not retroactively revalue historical data using current exchange rates or introduce implicit conversion into existing revenue aggregation.
- **Decision still required:** Select the FX-rate source, valuation timestamp, rounding policy, and migration strategy before implementing conversion.

### Exact Stripe business/event-time revenue recognition semantics

- **Why deferred:** Stripe event creation time, subscription period boundaries, webhook receipt time, and synchronization time represent different business meanings.
- **Decision required:** Define the authoritative effective timestamp and rules for late or out-of-order events and backdated changes.
- **Must not change accidentally:** Do not rewrite snapshot timestamps, invent prorated periods, or retroactively alter financial history.

### Admin and support tooling

- **Why deferred:** Operational workflows, authorization boundaries, audit requirements, and safe recovery actions are not yet defined.
- **Decision required:** Identify supported operator roles, permitted actions, audit retention, and approval requirements.
- **Must not change accidentally:** Do not add tenant-bypassing access, secret recovery, destructive history editing, or unaudited financial corrections.

## 3. Future expansion

- **Additional billing providers:** Extend customer identity to an explicit provider plus native billing customer ID when another billing provider is introduced. Preserve native provider IDs as the public integration contract.
- **Additional official SDKs:** Add SDKs for other languages based on demonstrated adoption. Keep each SDK small, transparent, server-side oriented, and aligned with the existing ingestion contract.
