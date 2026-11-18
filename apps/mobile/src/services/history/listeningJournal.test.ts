import { beforeEach, describe, expect, it } from 'vitest';
import type { ListeningEvent } from '@sinc/shared';
import { listeningJournal } from './listeningJournal';

function makeEvent(id: string, trackId: string, eventType: ListeningEvent['eventType']): ListeningEvent {
  return {
    id,
    sessionId: `sess-${trackId}`,
    trackId,
    trackTitle: `Title ${trackId}`,
    artistName: 'Artist Name',
    eventType,
    timestamp: Date.now(),
    positionMs: 15_000,
    playbackDurationMs: 15_000,
    trackDurationMs: 180_000,
    completionRatio: 0.1,
    idempotencyId: `idem-${id}`,
  };
}

describe('ListeningJournal', () => {
  beforeEach(() => {
    listeningJournal.clearAll();
  });

  it('appends events and prevents duplicate recording by idempotencyId', () => {
    const ev1 = makeEvent('e1', 't1', 'track_started');
    const ev2 = makeEvent('e1', 't1', 'track_started'); // Duplicate idempotencyId

    const added1 = listeningJournal.append(ev1);
    const added2 = listeningJournal.append(ev2);

    expect(added1).toBe(true);
    expect(added2).toBe(false);
    expect(listeningJournal.getRecordCount()).toBe(1);
    expect(listeningJournal.getAllEvents()).toHaveLength(1);
  });

  it('retrieves events for a specific session ID', () => {
    const ev1 = makeEvent('e1', 't1', 'track_started');
    const ev2 = makeEvent('e2', 't1', 'playback_progress');
    const ev3 = makeEvent('e3', 't2', 'track_started');

    listeningJournal.append(ev1);
    listeningJournal.append(ev2);
    listeningJournal.append(ev3);

    const sessionEvents = listeningJournal.getEventsForSession('sess-t1');
    expect(sessionEvents).toHaveLength(2);
    expect(sessionEvents.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('tracks sync status and marks events as synced', () => {
    const ev1 = makeEvent('e1', 't1', 'track_started');
    const ev2 = makeEvent('e2', 't2', 'track_started');

    listeningJournal.append(ev1);
    listeningJournal.append(ev2);

    expect(listeningJournal.getPendingSync()).toHaveLength(2);

    listeningJournal.markSynced(['idem-e1']);

    const pending = listeningJournal.getPendingSync();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe('e2');
  });

  it('wipes all stored events on clearAll (privacy / GDPR requirement)', () => {
    listeningJournal.append(makeEvent('e1', 't1', 'track_started'));
    listeningJournal.append(makeEvent('e2', 't2', 'track_started'));

    expect(listeningJournal.getRecordCount()).toBe(2);

    listeningJournal.clearAll();

    expect(listeningJournal.getRecordCount()).toBe(0);
    expect(listeningJournal.getAllEvents()).toHaveLength(0);
    expect(listeningJournal.getPendingSync()).toHaveLength(0);
  });

  it('caps total records to MAX_JOURNAL_EVENTS', () => {
    // Append small batch to verify order
    for (let i = 0; i < 5; i++) {
      listeningJournal.append(makeEvent(`e-${i}`, `t-${i}`, 'track_started'));
    }
    expect(listeningJournal.getRecordCount()).toBe(5);
  });
});
