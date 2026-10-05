import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AlertSeverity, OrganizationRole } from '../../common/enums/domain.enums';
import { ForbiddenError } from '../../common/errors/application.error';
import {
  NotificationDeliveryEntity,
  NotificationPreferenceEntity,
  OrganizationMemberEntity,
} from '../../database/entities';
import { UpdateNotificationPreferencesDto } from './dto/notification-preferences.dto';
import { EMAIL_GATEWAY, EmailGateway, EmailGatewayError } from './email.gateway';
import { MetricsService } from '../operations/metrics.service';

@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<boolean> | null = null;
  private shuttingDown = false;
  constructor(
    private readonly dataSource: DataSource,
    @Inject(EMAIL_GATEWAY) private readonly gateway: EmailGateway,
    private readonly metrics: MetricsService,
    private readonly config?: ConfigService,
  ) {}
  onModuleInit() {
    const interval = this.config?.get<number>('app.notificationWorkerIntervalMs') ?? 5_000;
    this.timer = setInterval(() => {
      this.tick();
    }, interval);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    if (this.inFlight) await this.inFlight;
  }
  private tick(): void {
    if (this.shuttingDown || this.inFlight) return;
    this.inFlight = this.processOne()
      .catch((error: unknown) => {
        this.logger.error({
          event: 'NotificationWorkerIterationFailed',
          errorType: error instanceof Error ? error.name : 'unknown',
        });
        return false;
      })
      .finally(() => {
        this.inFlight = null;
      });
  }

  async getPreferences(org: string) {
    return (
      (await this.dataSource.manager.findOneBy(NotificationPreferenceEntity, {
        organizationId: org,
      })) ?? {
        emailEnabled: false,
        warningAlertsEnabled: true,
        criticalAlertsEnabled: true,
        recoveryAlertsEnabled: true,
        recipients: [],
      }
    );
  }
  async updatePreferences(org: string, userId: string, dto: UpdateNotificationPreferencesDto) {
    const recipients = [...new Set(dto.recipients.map((x) => x.trim().toLowerCase()))];
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOneBy(OrganizationMemberEntity, {
        organizationId: org,
        userId,
      });
      if (!member || ![OrganizationRole.Owner, OrganizationRole.Admin].includes(member.role))
        throw new ForbiddenError('Owner or admin role is required.');
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`N${org}`]);
      let row = await manager.findOneBy(NotificationPreferenceEntity, { organizationId: org });
      const now = new Date();
      if (!row)
        row = manager.create(NotificationPreferenceEntity, {
          id: randomUUID(),
          organizationId: org,
          createdAt: now,
        });
      Object.assign(row, dto, { recipients, updatedAt: now });
      return manager.save(row);
    });
  }
  recent(org: string) {
    return this.dataSource.manager.find(NotificationDeliveryEntity, {
      where: { organizationId: org },
      order: { createdAt: 'DESC' },
      take: 25,
    });
  }
  async enqueue(
    org: string,
    alertId: string,
    severity: AlertSeverity,
    transition: string,
    manager: EntityManager,
  ) {
    const preference = await manager.findOneBy(NotificationPreferenceEntity, {
      organizationId: org,
    });
    if (!preference?.emailEnabled || preference.recipients.length === 0) return;
    const enabled =
      transition === 'resolved'
        ? preference.recoveryAlertsEnabled
        : severity === AlertSeverity.Critical
          ? preference.criticalAlertsEnabled
          : preference.warningAlertsEnabled;
    if (!enabled) return;
    const now = new Date();
    await manager
      .createQueryBuilder()
      .insert()
      .into(NotificationDeliveryEntity)
      .values(
        preference.recipients.map((recipient) => ({
          id: randomUUID(),
          organizationId: org,
          alertId,
          channel: 'email',
          recipient,
          transition,
          status: 'pending',
          attemptCount: 0,
          lastAttemptAt: null,
          nextAttemptAt: now,
          sentAt: null,
          failureReason: null,
          createdAt: now,
        })),
      )
      .orIgnore()
      .execute();
  }
  async processOne(organizationId?: string) {
    const claimed = await this.dataSource.transaction(async (manager) => {
      const tenantFilter = organizationId ? 'AND "OrganizationId"=$1' : '';
      const rows = await manager.query<{ Id: string }[]>(
        `SELECT "Id" FROM "notification_deliveries"
        WHERE (("Status"='pending' AND "NextAttemptAt"<=now()) OR ("Status"='processing' AND "LastAttemptAt"<now()-interval '5 minutes'))
        ${tenantFilter}
        ORDER BY "CreatedAt" FOR UPDATE SKIP LOCKED LIMIT 1`,
        organizationId ? [organizationId] : [],
      );
      if (!rows[0]) return null;
      const row = await manager.findOneByOrFail(NotificationDeliveryEntity, { id: rows[0].Id });
      row.status = 'processing';
      row.attemptCount += 1;
      row.lastAttemptAt = new Date();
      await manager.save(row);
      return row;
    });
    if (!claimed) return false;
    try {
      const context = await this.deliveryContext(claimed.alertId, claimed.organizationId);
      await this.gateway.send({
        deliveryId: claimed.id,
        organizationId: claimed.organizationId,
        alertId: claimed.alertId,
        recipient: claimed.recipient,
        transition: claimed.transition,
        customerName: context.customerName,
        revenue: context.revenue,
        aiCost: context.aiCost,
        grossMargin: context.grossMargin,
        budgetState:
          claimed.transition === 'resolved'
            ? 'healthy'
            : context.severity === AlertSeverity.Critical
              ? 'critical'
              : 'warning',
        currency: context.currency,
      });
      await this.finish(claimed.id, true, false);
      return true;
    } catch (error) {
      await this.finish(claimed.id, false, error instanceof EmailGatewayError && error.retryable);
      return false;
    }
  }
  private async deliveryContext(alertId: string, org: string) {
    const rows = await this.dataSource.manager.query<
      Array<{
        customerName: string;
        revenue: string;
        aiCost: string;
        grossMargin: string | null;
        currency: string;
        severity: AlertSeverity;
      }>
    >(
      `SELECT c."Name" AS "customerName", COALESCE(s."Revenue",c."MonthlyRevenue")::text AS revenue,
      COALESCE(s."AiCost",0)::text AS "aiCost", s."GrossMargin"::text AS "grossMargin",
      c."Currency" AS currency, a."Severity" AS severity
      FROM "margin_alerts" a
      JOIN customers c ON c."Id"=a."CustomerId" AND c."OrganizationId"=a."OrganizationId"
      LEFT JOIN LATERAL (SELECT ms."Revenue",ms."AiCost",ms."GrossMargin" FROM margin_snapshots ms
        WHERE ms."OrganizationId"=a."OrganizationId" AND ms."CustomerId"=a."CustomerId"
        ORDER BY ms."UpdatedAt" DESC LIMIT 1) s ON true
      WHERE a."Id"=$1 AND a."OrganizationId"=$2`,
      [alertId, org],
    );
    if (!rows[0]) throw new EmailGatewayError(false);
    return rows[0];
  }
  private async finish(id: string, sent: boolean, retryable: boolean) {
    const row = await this.dataSource.manager.findOneByOrFail(NotificationDeliveryEntity, { id });
    if (sent) {
      row.status = 'sent';
      row.sentAt = new Date();
      row.nextAttemptAt = null;
      row.failureReason = null;
      this.metrics.notification('sent');
    } else if (retryable && row.attemptCount < 3) {
      row.status = 'pending';
      row.nextAttemptAt = new Date(Date.now() + row.attemptCount * 1000);
      row.failureReason = 'Delivery failed; retry scheduled.';
      this.metrics.notification('retried');
    } else {
      row.status = 'failed';
      row.nextAttemptAt = null;
      row.failureReason = 'Delivery failed.';
      this.metrics.notification('failed');
    }
    await this.dataSource.manager.save(row);
  }
}
