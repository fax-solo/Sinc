import { prisma } from '../../lib/prisma.js';

export const ANALYTICS_EVENTS = [
  'search:success',
  'playback:start',
  'playback:complete',
  'download:complete',
  'lyrics:matched',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export interface AnalyticsEventInput {
  event: AnalyticsEventName;
  entityId?: string;
  meta?: Record<string, string | number | boolean>;
}

export class AnalyticsService {
  private async optIn(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });
    return (
      user?.settings != null &&
      (user.settings as { analyticsEnabled?: unknown }).analyticsEnabled === true
    );
  }

  async getPreference(userId: string): Promise<{ enabled: boolean }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });
    if (!user) return { enabled: false };
    return {
      enabled: (user.settings as { analyticsEnabled?: boolean } | null)?.analyticsEnabled === true,
    };
  }

  async setPreference(userId: string, enabled: boolean): Promise<{ enabled: boolean }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });
    if (!user) return { enabled };
    await prisma.user.update({
      where: { id: userId },
      data: {
        settings: { ...((user.settings ?? {}) as object), analyticsEnabled: enabled } as object,
      },
    });
    return { enabled };
  }

  /**
   * Records a batch of privacy-clean events, but only when the user has opted
   * in. Event names are validated against a fixed allowlist; entity ids and
   * scalar metadata are stored verbatim (no derived PII is ever constructed).
   */
  async record(userId: string, events: AnalyticsEventInput[]): Promise<{ recorded: number }> {
    const allowed = events.filter((e) => (ANALYTICS_EVENTS as readonly string[]).includes(e.event));
    if (allowed.length === 0) return { recorded: 0 };
    if (!(await this.optIn(userId))) return { recorded: 0 };
    await prisma.analyticsEvent.createMany({
      data: allowed.map((e) => ({
        userId,
        event: e.event,
        entityId: e.entityId ?? null,
        meta: (e.meta as object | null) ?? undefined,
      })),
    });
    return { recorded: allowed.length };
  }
}
