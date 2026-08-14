import { describe, expect, it } from 'vitest';
import { SyncService } from '../domain/sync/sync.service.js';
import { MemorySyncStore } from '../persistence/memory-sync-store.js';
import type { SyncMutation } from '@sinc/shared';

function upsert(
  opId: string,
  playlistId: string,
  baseVersion: number,
  name: string,
  trackIds: string[] = [],
): SyncMutation {
  return {
    kind: 'playlistUpsert',
    opId,
    playlistId,
    baseVersion,
    name,
    trackIds,
    createdAt: Date.now(),
  };
}

function del(opId: string, playlistId: string, baseVersion: number): SyncMutation {
  return { kind: 'playlistDelete', opId, playlistId, baseVersion };
}

function toggle(
  opId: string,
  targetType: 'track' | 'artist' | 'album',
  targetId: string,
  addedAt = Date.now(),
): SyncMutation {
  return { kind: 'favoriteToggle', opId, targetType, targetId, addedAt };
}

describe('SyncService', () => {
  it('creates a playlist at version 1 and applies versioned updates', async () => {
    const service = new SyncService(new MemorySyncStore());
    const first = await service.apply('user-1', [upsert('op1', 'p1', 0, 'Road Trip', ['t1'])]);
    expect(first.applied).toEqual(['op1']);
    expect(first.conflicts).toEqual([]);
    expect(first.snapshot.playlists).toHaveLength(1);
    expect(first.snapshot.playlists[0]?.version).toBe(1);

    const second = await service.apply('user-1', [
      upsert('op2', 'p1', 1, 'Road Trip', ['t1', 't2']),
    ]);
    expect(second.applied).toEqual(['op2']);
    expect(second.snapshot.playlists[0]?.version).toBe(2);
    expect(second.snapshot.playlists[0]?.trackIds).toEqual(['t1', 't2']);
  });

  it('rejects a playlist mutation built on a stale base version', async () => {
    const service = new SyncService(new MemorySyncStore());
    await service.apply('user-1', [upsert('op1', 'p1', 0, 'A')]);
    const result = await service.apply('user-1', [
      upsert('op2', 'p1', 1, 'B'),
      upsert('op3', 'p1', 0, 'C'),
    ]);
    expect(result.applied).toEqual(['op2']);
    expect(result.conflicts).toEqual([
      {
        kind: 'playlistVersion',
        playlistId: 'p1',
        clientBaseVersion: 0,
        serverVersion: 2,
      },
    ]);
    expect(result.snapshot.playlists[0]?.name).toBe('B');
  });

  it('deletes a playlist only when the version matches; stale delete conflicts', async () => {
    const service = new SyncService(new MemorySyncStore());
    await service.apply('user-1', [upsert('op1', 'p1', 0, 'A')]);

    const stale = await service.apply('user-1', [del('op2', 'p1', 0)]);
    expect(stale.conflicts).toHaveLength(1);
    expect(stale.snapshot.playlists).toHaveLength(1);

    const gone = await service.apply('user-1', [del('op3', 'p1', 1)]);
    expect(gone.applied).toEqual(['op3']);
    expect(gone.snapshot.playlists).toHaveLength(0);
  });

  it('delete of an unknown playlist is idempotent (no conflict)', async () => {
    const service = new SyncService(new MemorySyncStore());
    const result = await service.apply('user-1', [del('op1', 'ghost', 0)]);
    expect(result.applied).toEqual(['op1']);
    expect(result.conflicts).toEqual([]);
  });

  it('merges favorite toggles as a union across batches', async () => {
    const service = new SyncService(new MemorySyncStore());
    await service.apply('user-1', [
      toggle('op1', 'track', 't1', 1000),
      toggle('op2', 'artist', 'a1', 2000),
      toggle('op3', 'track', 't1', 3000), // removes t1 again
    ]);
    const after = await service.apply('user-1', [toggle('op4', 'album', 'al1', 4000)]);
    expect(after.snapshot.favorites.map((f) => `${f.targetType}:${f.targetId}`)).toEqual([
      'artist:a1',
      'album:al1',
    ]);
  });

  it('isolates users from each other', async () => {
    const service = new SyncService(new MemorySyncStore());
    await service.apply('user-1', [upsert('op1', 'p1', 0, 'Mine')]);
    const other = await service.apply('user-2', [upsert('op2', 'p2', 0, 'Theirs')]);
    expect(other.snapshot.playlists.map((p) => p.id)).toEqual(['p2']);
    const back = await service.snapshot('user-1');
    expect(back.playlists.map((p) => p.id)).toEqual(['p1']);
  });

  it('reconciles concurrent device edits via server-wins conflict handling', async () => {
    const service = new SyncService(new MemorySyncStore());
    await service.apply('user-1', [upsert('op1', 'p1', 0, 'Base', ['t1'])]);

    // Device A renames, device B reorders off the same base.
    const a = await service.apply('user-1', [upsert('op2', 'p1', 1, 'Renamed', ['t1'])]);
    const b = await service.apply('user-1', [upsert('op3', 'p1', 1, 'Base', ['t2'])]);
    expect(b.conflicts).toHaveLength(1);
    expect(b.snapshot.playlists[0]?.name).toBe('Renamed');
    expect(a.snapshot.playlists[0]?.version).toBe(2);
  });
});
