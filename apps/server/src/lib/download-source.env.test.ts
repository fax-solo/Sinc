import { mkdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTrack } from '@sinc/shared';

const h = vi.hoisted(() => ({
  env: {
    JAMENDO_CLIENT_ID: undefined as string | undefined,
    FMA_API_KEY: undefined as string | undefined,
  },
}));

vi.mock('../config/env.js', () => ({ getEnv: () => h.env }));

const { JamendoSource, FmaSource } = await import('./download-source.js');

const track: CanonicalTrack = {
  id: 'track-1',
  title: 'Test Song',
  artists: [{ id: 'a1', name: 'Test Artist', providerIds: {}, genres: [] }],
  durationMs: 120_000,
  explicit: false,
  providerIds: {},
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

function audioResponse(): Response {
  const bytes = new Uint8Array(4096);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    headers: { get: () => '4096' },
    body: stream,
  } as unknown as Response;
}

for (const dir of ['/tmp/sinc-t2', '/tmp/sinc-t4']) {
  mkdirSync(dir, { recursive: true });
}

describe('download-source env plumbing (Jamendo/FMA)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    h.env.JAMENDO_CLIENT_ID = undefined;
    h.env.FMA_API_KEY = undefined;
  });

  it('Jamendo skips (returns null) without a configured client id and never hits the network', async () => {
    const spy = vi.fn(async () => jsonResponse({ results: [{ audio: 'https://x/1.mp3' }] }));
    vi.stubGlobal('fetch', spy);
    const src = new JamendoSource();
    const result = await src.download(track, undefined, 'stem', '/tmp/sinc-t', () => undefined);
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('Jamendo includes the validated client id in the API request', async () => {
    h.env.JAMENDO_CLIENT_ID = 'jamendo-key-123';
    const spy = vi.fn(async (url: string) =>
      String(url).includes('api.jamendo.com')
        ? jsonResponse({ results: [{ audio: 'https://jamendo/audio.mp3' }] })
        : audioResponse()
    );
    vi.stubGlobal('fetch', spy);
    const src = new JamendoSource();
    const result = await src.download(track, undefined, 'stem', '/tmp/sinc-t2', () => undefined);
    expect(result?.provider).toBe('jamendo');
    const jamendoCall = spy.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes('api.jamendo.com'));
    expect(jamendoCall).toContain('client_id=jamendo-key-123');
  });

  it('FMA skips (returns null) without a configured api key', async () => {
    const spy = vi.fn(async () => jsonResponse({ dataset: [] }));
    vi.stubGlobal('fetch', spy);
    const src = new FmaSource();
    const result = await src.download(track, undefined, 'stem', '/tmp/sinc-t3', () => undefined);
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('FMA includes the validated api key in the request', async () => {
    h.env.FMA_API_KEY = 'fma-key-456';
    const spy = vi.fn(async (url: string) =>
      String(url).includes('freemusicarchive.org')
        ? jsonResponse({
            dataset: [{ track_file: 'https://fma/audio.mp3', track_title: 'Test Song' }],
          })
        : audioResponse()
    );
    vi.stubGlobal('fetch', spy);
    const src = new FmaSource();
    const result = await src.download(track, undefined, 'stem', '/tmp/sinc-t4', () => undefined);
    expect(result?.provider).toBe('fma');
    const fmaCall = spy.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes('freemusicarchive.org'));
    expect(fmaCall).toContain('api_key=fma-key-456');
  });

  it('archive source downloads bytes to disk and reports progress', async () => {
    const spy = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('archive.org/advancedsearch.php')) {
        return jsonResponse({ response: { docs: [{ identifier: 'id1' }] } });
      }
      if (u.includes('archive.org/metadata/')) {
        return jsonResponse({ files: [{ name: 'song.mp3', format: 'Audio' }] });
      }
      return audioResponse();
    });
    vi.stubGlobal('fetch', spy);
    const { InternetArchiveSource } = await import('./download-source.js');
    mkdirSync('/tmp/sinc-t5', { recursive: true });
    const src = new InternetArchiveSource();
    const seen: number[] = [];
    const result = await src.download(track, undefined, 'stem', '/tmp/sinc-t5', (p) =>
      seen.push(p)
    );
    expect(result?.provider).toBe('archive');
    expect(result?.filePath).toBe('/tmp/sinc-t5/stem.mp3');
    expect(seen[seen.length - 1]).toBe(100);
  });
});
