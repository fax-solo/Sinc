import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import type { LyricsService } from '../../lib/lyrics.js';
import type { CanonicalTrack, TrackLyrics } from '@sinc/shared';

const suffix = randomUUID().slice(0, 8);
const email = `lyr-${suffix}@sinc.dev`;
const username = `lyr_${suffix}`;
const password = 'correct-horse-battery';

const track: CanonicalTrack = {
  id: 'itunes:1',
  title: 'Lyric Song',
  artists: [{ id: 'a1', name: 'Lyric Artist', providerIds: {}, genres: [] }],
  durationMs: 120_000,
  explicit: false,
  providerIds: { itunes: '1' },
};

const fakeLyrics: TrackLyrics = {
  trackId: track.id,
  provider: 'lrclib',
  synced: true,
  language: 'en',
  lines: [
    { timeMs: 0, text: 'First line' },
    { timeMs: 5_000, text: 'Second line' },
  ],
};

const fakeService = {
  getLyrics: async (t: CanonicalTrack): Promise<TrackLyrics> => ({ ...fakeLyrics, trackId: t.id }),
  warmTrack: async () => undefined,
} as unknown as LyricsService;

const app = await buildApp(undefined, { lyrics: fakeService });

let accessToken = '';

async function login() {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, username, password, displayName: 'Lyrics Test' },
  });
  if (res.statusCode !== 201) {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    accessToken = login.json().tokens.accessToken;
  } else {
    accessToken = res.json().tokens.accessToken;
  }
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } }).catch(() => undefined);
  await app.close();
});

describe('lyrics module', () => {
  it('rejects lyrics without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/music/tracks/itunes:1/lyrics',
      payload: { track },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects lyrics without a track payload', async () => {
    await login();
    const res = await app.inject({
      method: 'POST',
      url: '/music/tracks/itunes:1/lyrics',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns lyrics for a track', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/music/tracks/itunes:1/lyrics',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { track },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trackId).toBe(track.id);
    expect(body.synced).toBe(true);
    expect(body.provider).toBe('lrclib');
    expect(body.lines.length).toBe(2);
    expect(body.lines[1].timeMs).toBe(5_000);
  });
});
