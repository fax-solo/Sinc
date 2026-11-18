/**
 * Sinc Listening Journal
 *
 * Durable write-ahead storage for discrete listening events on device.
 * - Backed by encrypted MMKV with in-memory caching.
 * - Enforces idempotency via unique idempotency identifiers.
 * - Tracks sync state for offline-to-online reconciliation.
 * - Supports complete data wiping for user privacy & GDPR.
 * - Recomputes deterministic user taste profile on demand.
 */

import type {
  DiscoveryMode,
  ListeningEvent,
  MusicTasteProfile,
} from '@sinc/shared';
import { computeUserTasteProfile } from '@sinc/shared';
import { storage, STORAGE_KEYS } from '../../utils/storage';
import { useLibraryStore } from '../library/libraryStore';

export const MAX_JOURNAL_EVENTS = 5_000;

export interface JournalRecord {
  event: ListeningEvent;
  synced: boolean;
  loggedAt: number;
}

interface StoredJournal {
  records: JournalRecord[];
}

export class ListeningJournalService {
  private inMemoryRecords: JournalRecord[] | null = null;
  private seenIdempotency = new Set<string>();

  private load(): JournalRecord[] {
    if (this.inMemoryRecords !== null) {
      return this.inMemoryRecords;
    }

    try {
      const stored = storage.getObject<StoredJournal>(STORAGE_KEYS.LISTENING_JOURNAL);
      const records = stored?.records ?? [];
      this.inMemoryRecords = records;
      this.seenIdempotency = new Set(records.map((r) => r.event.idempotencyId || r.event.id));
      return records;
    } catch (err) {
      console.warn('Failed to load listening journal from storage:', err);
      this.inMemoryRecords = [];
      this.seenIdempotency = new Set();
      return [];
    }
  }

  private persist(records: JournalRecord[]): void {
    try {
      const trimmed =
        records.length > MAX_JOURNAL_EVENTS
          ? records.slice(records.length - MAX_JOURNAL_EVENTS)
          : records;
      this.inMemoryRecords = trimmed;
      storage.setObject<StoredJournal>(STORAGE_KEYS.LISTENING_JOURNAL, { records: trimmed });
    } catch (err) {
      console.warn('Failed to persist listening journal:', err);
    }
  }

  /**
   * Appends a listening event idempotently to the local journal.
   * If an event with the same idempotencyId was already recorded, it is safely ignored.
   */
  append(event: ListeningEvent): boolean {
    const key = event.idempotencyId || event.id;
    const records = this.load();

    if (this.seenIdempotency.has(key)) {
      return false;
    }

    const record: JournalRecord = {
      event,
      synced: false,
      loggedAt: Date.now(),
    };

    this.seenIdempotency.add(key);
    records.push(record);
    this.persist(records);
    return true;
  }

  /**
   * Returns all recorded listening events, newest first.
   */
  getAllEvents(): ListeningEvent[] {
    const records = this.load();
    return records.map((r) => r.event).reverse();
  }

  /**
   * Returns events belonging to a specific playback session.
   */
  getEventsForSession(sessionId: string): ListeningEvent[] {
    const records = this.load();
    return records.filter((r) => r.event.sessionId === sessionId).map((r) => r.event);
  }

  /**
   * Returns all unsynced events ready to be pushed to the server.
   */
  getPendingSync(): ListeningEvent[] {
    const records = this.load();
    return records.filter((r) => !r.synced).map((r) => r.event);
  }

  /**
   * Alias for getPendingSync.
   */
  getPendingEvents(): ListeningEvent[] {
    return this.getPendingSync();
  }

  /**
   * Checks whether an idempotency identifier has already been recorded in this journal.
   */
  hasIdempotencyId(idempotencyId: string): boolean {
    this.load();
    return this.seenIdempotency.has(idempotencyId);
  }

  /**
   * Marks a batch of events as successfully synchronized with the backend.
   */
  markSynced(idempotencyIds: string[]): void {
    if (idempotencyIds.length === 0) return;
    const idSet = new Set(idempotencyIds);
    const records = this.load();
    let updated = false;

    for (const record of records) {
      const key = record.event.idempotencyId || record.event.id;
      if (idSet.has(key) && !record.synced) {
        record.synced = true;
        updated = true;
      }
    }

    if (updated) {
      this.persist(records);
    }
  }

  /**
   * Clears the entire listening journal for privacy, logout, or GDPR data erasure.
   */
  clearAll(): void {
    this.inMemoryRecords = [];
    this.seenIdempotency.clear();
    try {
      storage.remove(STORAGE_KEYS.LISTENING_JOURNAL);
    } catch {
      // ignore
    }
  }

  /**
   * Computes the user taste profile deterministically from the current journal and library state.
   */
  recalculateTasteProfile(
    discoveryMode?: DiscoveryMode,
    discoveryPreference?: number
  ): MusicTasteProfile {
    const records = this.load();
    const events = records.map((r) => r.event);
    const library = useLibraryStore.getState();

    return computeUserTasteProfile({
      events,
      favoriteTracks: library.favoriteTracks,
      followedArtists: library.followedArtists,
      followedAlbums: library.followedAlbums,
      downloadedTracks: library.favoriteTracks,
      discoveryMode,
      discoveryPreference,
      personalizationEnabled: true,
      nowMs: Date.now(),
    });
  }

  /**
   * Direct inspection for unit tests.
   */
  getRecordCount(): number {
    return this.load().length;
  }
}

export const listeningJournal = new ListeningJournalService();
