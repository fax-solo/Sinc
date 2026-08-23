/**
 * Retention sweeps. Tables that only ever grow (expired sessions/tokens,
 * spent search-cache rows, raw analytics events, audit trail) are trimmed on
 * a schedule so the database stays small and queries stay fast. Per-user
 * history is capped on write in the signals service, so it needs no sweep.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma.js';

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 60 * 1000;
/** Raw analytics events are aggregated into dashboards; keep a quarter. */
const ANALYTICS_RETENTION_DAYS = 90;
/** Audit trail is compliance-relevant; keep twice as long. */
const AUDIT_RETENTION_DAYS = 180;
/** Revoked sessions linger briefly so "sign out everywhere" audits make sense. */
const REVOKED_SESSION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function runRetentionSweep(db: PrismaClient = defaultPrisma): Promise<void> {
  const now = new Date();
  const revokedCutoff = new Date(now.getTime() - REVOKED_SESSION_GRACE_MS);
  const analyticsCutoff = daysAgo(ANALYTICS_RETENTION_DAYS);
  const auditCutoff = daysAgo(AUDIT_RETENTION_DAYS);

  await Promise.all([
    db.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: revokedCutoff } }] },
    }),
    db.verificationToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.searchCache.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.analyticsEvent.deleteMany({ where: { createdAt: { lt: analyticsCutoff } } }),
    db.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
  ]);
}

/** Starts the periodic sweeper; returns a disposer for graceful shutdown. */
export function startRetentionSweeper(db: PrismaClient = defaultPrisma): () => void {
  const timer = setInterval(() => {
    void runRetentionSweep(db).catch(() => undefined);
  }, SWEEP_INTERVAL_MS);
  const firstRun = setTimeout(() => {
    void runRetentionSweep(db).catch(() => undefined);
  }, FIRST_SWEEP_DELAY_MS);
  return () => {
    clearInterval(timer);
    clearTimeout(firstRun);
  };
}
