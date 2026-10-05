import { Injectable } from '@nestjs/common';

const buckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
@Injectable()
export class MetricsService {
  private readonly requests = new Map<string, number>();
  private readonly latency = new Map<string, { count: number; sum: number; buckets: number[] }>();
  private readonly events = new Map<string, number>();
  private readonly pricingRefreshSuccess = new Map<string, number>();

  constructor() {
    [
      'margintra_ingestion_accepted_total',
      'margintra_ingestion_rejected_total',
      'margintra_stripe_webhook_success_total',
      'margintra_stripe_webhook_failure_total',
      'margintra_notification_sent_total',
      'margintra_notification_failed_total',
      'margintra_notification_retried_total',
      'margintra_usage_inbox_accepted_total',
      'margintra_usage_inbox_processed_total',
      'margintra_usage_inbox_failed_total',
      'margintra_usage_inbox_retry_total',
      'margintra_usage_inbox_stale_recovered_total',
      'margintra_usage_inbox_pending_pricing_total',
      'margintra_pricing_discovery_attempt_total',
      'margintra_pricing_candidate_created_total',
      'margintra_pricing_version_activated_total',
      'margintra_pricing_refresh_attempt_total',
      'margintra_pricing_refresh_success_total',
      'margintra_pricing_refresh_failure_total',
      'margintra_pricing_refresh_unavailable_total',
      'margintra_pricing_refresh_unchanged_total',
      'margintra_pricing_refresh_pending_created_total',
      'margintra_pricing_refresh_request_coalesced_total',
      'margintra_stripe_webhook_retry_scheduled_total',
      'margintra_stripe_webhook_retry_success_total',
      'margintra_stripe_webhook_retry_failure_total',
      'margintra_stripe_webhook_retry_exhausted_total',
    ].forEach((name) => this.events.set(name, 0));
  }

  recordHttp(method: string, route: string, status: number, durationSeconds: number): void {
    const labels = `method="${method}",route="${route}",status="${String(status)}"`;
    this.requests.set(labels, (this.requests.get(labels) ?? 0) + 1);
    const latencyLabels = `method="${method}",route="${route}"`;
    const value = this.latency.get(latencyLabels) ?? {
      count: 0,
      sum: 0,
      buckets: buckets.map(() => 0),
    };
    value.count += 1;
    value.sum += durationSeconds;
    buckets.forEach((bucket, index) => {
      if (durationSeconds <= bucket) value.buckets[index] = value.buckets[index]! + 1;
    });
    this.latency.set(latencyLabels, value);
    if (route === '/api/v1/ingest/usage')
      this.increment(`margintra_ingestion_${status < 400 ? 'accepted' : 'rejected'}_total`);
    if (route.startsWith('/api/v1/webhooks/stripe/'))
      this.increment(`margintra_stripe_webhook_${status < 400 ? 'success' : 'failure'}_total`);
  }
  notification(outcome: 'sent' | 'failed' | 'retried'): void {
    this.increment(`margintra_notification_${outcome}_total`);
  }
  usageInbox(
    outcome: 'accepted' | 'processed' | 'failed' | 'retry' | 'stale_recovered' | 'pending_pricing',
  ): void {
    this.increment(`margintra_usage_inbox_${outcome}_total`);
  }
  pricing(outcome: 'discovery' | 'candidate_created' | 'version_activated'): void {
    const metric = outcome === 'discovery' ? 'discovery_attempt' : outcome;
    this.increment(`margintra_pricing_${metric}_total`);
  }
  pricingRefresh(
    outcome: 'attempt' | 'success' | 'failure' | 'unavailable' | 'request_coalesced',
    _provider: string,
  ): void {
    void _provider;
    this.increment(`margintra_pricing_refresh_${outcome}_total`);
  }
  pricingRefreshCandidates(_provider: string, unchanged: number, pendingCreated: number): void {
    void _provider;
    this.add('margintra_pricing_refresh_unchanged_total', unchanged);
    this.add('margintra_pricing_refresh_pending_created_total', pendingCreated);
  }
  pricingRefreshSucceededAt(provider: string, timestamp: Date): void {
    this.pricingRefreshSuccess.set(provider, timestamp.getTime() / 1000);
  }
  stripeWebhookRetry(outcome: 'scheduled' | 'success' | 'failure' | 'exhausted'): void {
    this.increment(`margintra_stripe_webhook_retry_${outcome}_total`);
  }
  render(workerCounts: Record<string, number>, inboxCounts: Record<string, number> = {}): string {
    const lines = [
      '# HELP margintra_http_requests_total HTTP requests received.',
      '# TYPE margintra_http_requests_total counter',
      ...[...this.requests].map(
        ([labels, value]) => `margintra_http_requests_total{${labels}} ${String(value)}`,
      ),
      '# HELP margintra_http_request_duration_seconds HTTP response latency.',
      '# TYPE margintra_http_request_duration_seconds histogram',
    ];
    for (const [labels, value] of this.latency) {
      buckets.forEach((bucket, index) =>
        lines.push(
          `margintra_http_request_duration_seconds_bucket{${labels},le="${String(bucket)}"} ${String(value.buckets[index])}`,
        ),
      );
      lines.push(
        `margintra_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${String(value.count)}`,
      );
      lines.push(`margintra_http_request_duration_seconds_sum{${labels}} ${String(value.sum)}`);
      lines.push(`margintra_http_request_duration_seconds_count{${labels}} ${String(value.count)}`);
    }
    for (const [name, value] of this.events)
      lines.push(`# TYPE ${name} counter`, `${name} ${String(value)}`);
    for (const [provider, value] of this.pricingRefreshSuccess)
      lines.push(
        `margintra_pricing_refresh_last_success_timestamp_seconds{provider="${provider}"} ${String(value)}`,
      );
    for (const [status, value] of Object.entries(workerCounts))
      lines.push(`margintra_notification_deliveries{status="${status}"} ${String(value)}`);
    for (const [status, value] of Object.entries(inboxCounts))
      lines.push(`margintra_usage_inbox{status="${status}"} ${String(value)}`);
    return `${lines.join('\n')}\n`;
  }
  private increment(name: string): void {
    this.events.set(name, (this.events.get(name) ?? 0) + 1);
  }
  private add(name: string, value: number): void {
    this.events.set(name, (this.events.get(name) ?? 0) + value);
  }
}
