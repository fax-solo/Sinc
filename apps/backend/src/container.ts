import { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import type {
  DeviceRepository,
  MailService,
  NotificationRepository,
  PasswordHasher,
  RateLimiter,
  SessionRepository,
  TokenService,
  UserRepository,
  VerificationTokenRepository,
} from './domain/auth/types.js';
import { PasswordHasherService } from './domain/auth/password.service.js';
import { TokenServiceJose } from './domain/auth/token.service.js';
import { SessionService } from './domain/auth/session.service.js';
import { VerificationService } from './domain/auth/verification.service.js';
import { AuthService } from './domain/auth/auth.service.js';
import { getPrismaClient } from './persistence/prisma.js';
import { PrismaUserRepository } from './persistence/user.repository.js';
import { PrismaSessionRepository } from './persistence/session.repository.js';
import { PrismaDeviceRepository } from './persistence/device.repository.js';
import { PrismaVerificationTokenRepository } from './persistence/verification-token.repository.js';
import { PrismaNotificationRepository } from './persistence/notification.repository.js';
import { ConsoleMailService } from './persistence/mail.service.js';
import { RateLimiterService } from './persistence/rate-limiter.js';
import { CatalogService } from './domain/catalog/catalog.service.js';
import { ProviderRegistryImpl } from './domain/catalog/registry.js';
import type { SourceProvider } from './domain/catalog/types.js';
import { MusicBrainzMetadataProvider } from './domain/catalog/providers/musicbrainz/index.js';
import { SearchCacheService, SingleFlight, type SearchCache } from './persistence/search-cache.js';
import { HomeFeedService } from './domain/home/home.service.js';
import { PlaybackService } from './domain/playback/playback.service.js';
import { SourceResolverService } from './domain/playback/source-resolver.service.js';
import { StreamSigner, ephemeralSecret } from './domain/playback/stream-signer.js';
import type { SyncStore } from './domain/sync/types.js';
import { SyncService } from './domain/sync/sync.service.js';
import { MemorySyncStore } from './persistence/memory-sync-store.js';
import type { Env } from './routes/health.js';

export interface Container {
  authService: AuthService;
  tokenService: TokenService;
  rateLimiter: RateLimiter;
  mailService: MailService;
  catalog: CatalogService;
  registry: ProviderRegistryImpl;
  searchCache: SearchCache;
  singleFlight: SingleFlight;
  homeFeed: HomeFeedService;
  playback: PlaybackService;
  streamSigner: StreamSigner;
  sync: SyncService;
  /** Disposable resources (redis/prisma). Called on app close. */
  close?: () => Promise<void>;
}

export interface ContainerOptions {
  env: Env;
  /** Test seam: inject in-memory repositories instead of Prisma. */
  repositories?: {
    user: UserRepository;
    session: SessionRepository;
    device: DeviceRepository;
    verificationToken: VerificationTokenRepository;
    notification: NotificationRepository;
  };
  /** Test seam: capture mail instead of logging. */
  mailService?: MailService;
  /** Test seam: stub the catalog to avoid provider fan-out. */
  catalog?: CatalogService;
  /** Test seam: stub the home feed sources. */
  homeFeed?: HomeFeedService;
  /** Test seam: register fake playback-source providers. */
  sourceProviders?: SourceProvider[];
  /** Test seam: stub the whole playback service. */
  playback?: PlaybackService;
  /** Test seam: fixed signing secret. */
  streamSigningSecret?: string;
  /** Test seam: inject sync state instead of the in-memory default. */
  syncStore?: SyncStore;
  searchCache?: SearchCache;
  redis?: Redis | null;
  db?: PrismaClient | null;
}

export function buildContainer(options: ContainerOptions): Container {
  const { env } = options;
  const redis =
    options.redis === undefined ? (env.REDIS_URL ? new Redis(env.REDIS_URL) : null) : options.redis;
  const prisma = options.db ?? getPrismaClient();
  const ownedDb = options.db === undefined;
  const closeables: Array<() => Promise<void>> = [];
  if (redis) closeables.push(() => redis.quit().then(() => undefined));
  if (ownedDb) closeables.push(() => prisma.$disconnect());

  const userRepository = options.repositories?.user ?? new PrismaUserRepository(prisma);
  const sessionRepository = options.repositories?.session ?? new PrismaSessionRepository(prisma);
  const deviceRepository = options.repositories?.device ?? new PrismaDeviceRepository(prisma);
  const verificationTokenRepository =
    options.repositories?.verificationToken ?? new PrismaVerificationTokenRepository(prisma);
  const notificationRepository =
    options.repositories?.notification ?? new PrismaNotificationRepository(prisma);

  const passwordHasher: PasswordHasher = new PasswordHasherService();
  const tokenService: TokenService = new TokenServiceJose(
    env.JWT_ACCESS_PRIVATE_KEY,
    env.JWT_ACCESS_PUBLIC_KEY,
    env.JWT_ACCESS_TTL_SECONDS,
  );
  const sessionService = new SessionService({
    userRepository,
    sessionRepository,
    notificationRepository,
    refreshTtlDays: env.JWT_REFRESH_TTL_DAYS,
  });
  const verificationService = new VerificationService({
    verificationTokenRepository,
    emailVerifyTtlHours: env.VERIFY_EMAIL_TTL_HOURS,
    passwordResetTtlMinutes: env.PASSWORD_RESET_TTL_MINUTES,
  });
  const mailService: MailService = options.mailService ?? new ConsoleMailService();
  const authService = new AuthService({
    userRepository,
    deviceRepository,
    passwordHasher,
    tokenService,
    sessionService,
    verificationService,
    mailService,
    appBaseUrl: env.APP_BASE_URL,
  });
  const rateLimiter: RateLimiter = new RateLimiterService(
    { windowSeconds: 60, maxRequests: 10 },
    redis,
    {
      search: { windowSeconds: 60, maxRequests: 30 },
      stream: { windowSeconds: 60, maxRequests: 60 },
    },
  );

  const registry = new ProviderRegistryImpl();
  registry.register(new MusicBrainzMetadataProvider());
  for (const source of options.sourceProviders ?? []) {
    registry.registerSource(source);
  }
  const catalog = options.catalog ?? new CatalogService(registry);
  const searchCache = options.searchCache ?? new SearchCacheService(redis);
  const singleFlight = new SingleFlight();
  const homeFeed = options.homeFeed ?? new HomeFeedService();

  const streamSigner = new StreamSigner(
    options.streamSigningSecret ?? env.STREAM_SIGNING_SECRET ?? ephemeralSecret(),
  );
  const playback =
    options.playback ??
    new PlaybackService({
      catalog,
      registry,
      resolver: new SourceResolverService(),
      signer: streamSigner,
      publicBaseUrl: `${env.APP_BASE_URL}/api/v1`,
    });
  const sync = new SyncService(options.syncStore ?? new MemorySyncStore());

  return {
    authService,
    tokenService,
    rateLimiter,
    mailService,
    catalog,
    registry,
    searchCache,
    singleFlight,
    homeFeed,
    playback,
    streamSigner,
    sync,
    close: closeables.length
      ? async () => {
          for (const close of closeables) {
            try {
              await close();
            } catch {
              // best-effort cleanup
            }
          }
        }
      : undefined,
  };
}
