import { prisma } from '../../lib/prisma.js';
import { hashPassword } from './password.js';
import type { AuthResponse, AuthService } from './service.js';

export const DEMO_EMAIL = 'demo@sinc.dev';
export const DEMO_USERNAME = 'demo';
/** Server-known credential for the shared demo account (not secret, public by design). */
export const DEMO_PASSWORD = 'sinc-demo-account';

interface DemoTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
}

const DEMO_TRACKS: DemoTrack[] = [
  {
    id: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
    title: 'Porcelain (Demo)',
    artist: 'Moby',
    album: 'Play',
  },
  { id: 'itunes:1440935116', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours' },
  { id: 'deezer:3135556', title: 'One More Time', artist: 'Daft Punk', album: 'Discovery' },
  {
    id: 'itunes:915701521',
    title: 'Get Lucky',
    artist: 'Daft Punk',
    album: 'Random Access Memories',
  },
  {
    id: 'spotify:track:0VjIjW4GlUZAMYd2vXMi3b',
    title: 'Dreams',
    artist: 'Fleetwood Mac',
    album: 'Rumours',
  },
];

/**
 * Creates the shared demo account and a small starter library so the demo
 * surfaces content on first login. Idempotent: re-runs (seed script, repeated
 * demo logins, CI) are no-ops once the account has a library.
 */
export async function provisionDemoUser(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      username: DEMO_USERNAME,
      displayName: 'Sinc Demo',
      passwordHash: await hashPassword(DEMO_PASSWORD),
      settings: { analyticsEnabled: false },
    },
  });

  const existing = await prisma.favorite.count({ where: { userId: user.id } });
  if (existing > 0) return;

  await prisma.favorite.createMany({
    data: DEMO_TRACKS.map((t) => ({
      userId: user.id,
      targetType: 'track',
      targetId: t.id,
      targetTitle: t.title,
      targetSubtitle: t.artist,
    })),
    skipDuplicates: true,
  });

  const playlist = await prisma.playlist.create({
    data: { userId: user.id, name: 'Demo Favorites', trackCount: DEMO_TRACKS.length },
  });
  await prisma.playlistEntry.createMany({
    data: DEMO_TRACKS.map((t, i) => ({ playlistId: playlist.id, trackId: t.id, position: i })),
    skipDuplicates: true,
  });

  for (const t of DEMO_TRACKS) {
    await prisma.history
      .upsert({
        where: { userId_trackId: { userId: user.id, trackId: t.id } },
        update: {},
        create: {
          userId: user.id,
          trackId: t.id,
          trackTitle: t.title,
          trackArtist: t.artist,
          trackAlbum: t.album,
          durationMs: 200000,
          sourceKind: 'demo',
          playedAt: new Date(Date.now() - Math.floor(Math.random() * 60 * 86_400_000)),
        },
      })
      .catch(() => undefined);
  }
}

/**
 * Demo login endpoint handler. Provisions the account once per process, then
 * issues a normal session so the demo user exercises the exact same auth
 * machinery (tokens, rotation, guards) as any other account.
 */
export class DemoService {
  private ready: Promise<AuthResponse> | null = null;

  constructor(private readonly auth: AuthService) {}

  login(): Promise<AuthResponse> {
    this.ready ??= this.provision();
    return this.ready;
  }

  private async provision(): Promise<AuthResponse> {
    await provisionDemoUser();
    return this.auth.login(
      { email: DEMO_EMAIL, password: DEMO_PASSWORD },
      'demo-provider',
      '127.0.0.1'
    );
  }
}
