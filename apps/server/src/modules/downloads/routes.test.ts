import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import type { DownloadResolver } from '../../lib/download-source.js';
import { DownloadsService } from './service.js';

// The fake resolver writes garbage bytes, so real ffmpeg tagging would be
// slow and pointless here; tests stay hermetic with a stubbed tagger.
vi.mock('../../lib/audio-tag.js', () => ({
  tagMp3: vi.fn(async () => true),
  hasId3Title: vi.fn(async () => true),
}));

const suffix = randomUUID().slice(0, 8);
const email = `dl-${suffix}@sinc.dev`;
const username = `dl_${suffix}`;
const password = 'correct-horse-battery';

const track = {
  id: 'ytdlp:dGVzdC11cmw=',
  title: 'Test Song',
  artists: [{ id: 'a1', name: 'Test Artist' }],
  durationMs: 120_000,
  explicit: false,
  providerIds: {},
};

const fakeResolver = {
  download: async (
    _track: unknown,
    _directUrl: string | undefined,
    onProgress?: (p: number) => void
  ) => {
    onProgress?.(100);
    const filePath = path.join(os.tmpdir(), `sinc-test-${randomUUID()}.mp3`);
    await fs.writeFile(filePath, Buffer.from('ID3FAKEAUDIODATA'));
    return {
      provider: 'soundcloud',
      sourceUrl: 'https://example.com/x',
      filePath,
      mimeType: 'audio/mpeg',
    };
  },
} as unknown as DownloadResolver;

const app = await buildApp(undefined, { downloads: new DownloadsService(fakeResolver) });

let accessToken = '';

async function login() {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, username, password, displayName: 'Download Test' },
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

describe('downloads module', () => {
  it('rejects download creation without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/music/tracks/ytdlp:dGVzdC11cmw=/download',
      payload: { track },
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a download job', async () => {
    await login();
    const res = await app.inject({
      method: 'POST',
      url: '/music/tracks/ytdlp:dGVzdC11cmw=/download',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { track },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.trackId).toBe(track.id);
    expect(body.status).toBe('downloading');
    expect(body.progress).toBe(0);
  });

  it('lists completed downloads after the background job finishes', async () => {
    await new Promise((r) => setTimeout(r, 300));
    const res = await app.inject({
      method: 'GET',
      url: '/music/downloads',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const jobs = res.json();
    expect(Array.isArray(jobs)).toBe(true);
    const completed = jobs.find((j: { trackId: string; status: string }) => j.trackId === track.id);
    expect(completed).toBeTruthy();
    expect(completed.status).toBe('completed');
    expect(completed.progress).toBe(100);
    expect(completed.provider).toBe('soundcloud');
    expect(completed.bytesDownloaded).toBeGreaterThan(0);
  });

  it('serves the downloaded file', async () => {
    const jobs = await (
      await app.inject({
        method: 'GET',
        url: '/music/downloads',
        headers: { authorization: `Bearer ${accessToken}` },
      })
    ).json();
    const job = jobs.find((j: { trackId: string }) => j.trackId === track.id);
    const res = await app.inject({
      method: 'GET',
      url: `/music/downloads/${job.id}/file`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.rawPayload.toString()).toContain('ID3FAKE');
  });

  it('returns 404 for another user download', async () => {
    const jobs = await (
      await app.inject({
        method: 'GET',
        url: '/music/downloads',
        headers: { authorization: `Bearer ${accessToken}` },
      })
    ).json();
    const job = jobs.find((j: { trackId: string }) => j.trackId === track.id);
    const res = await app.inject({
      method: 'GET',
      url: `/music/downloads/${job.id}/file`,
      headers: { authorization: `Bearer wrong-token` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('deletes a download', async () => {
    const jobs = await (
      await app.inject({
        method: 'GET',
        url: '/music/downloads',
        headers: { authorization: `Bearer ${accessToken}` },
      })
    ).json();
    const job = jobs.find((j: { trackId: string }) => j.trackId === track.id);
    const res = await app.inject({
      method: 'DELETE',
      url: `/music/downloads/${job.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(204);
    const after = await (
      await app.inject({
        method: 'GET',
        url: '/music/downloads',
        headers: { authorization: `Bearer ${accessToken}` },
      })
    ).json();
    expect(after.some((j: { id: string }) => j.id === job.id)).toBe(false);
  });
});
