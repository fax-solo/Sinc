import {
  ulid,
  ConflictError,
  NotFoundError,
  SincError,
  UnauthorizedError,
  ValidationError,
  ErrorCodes,
  type Role,
} from '@sinc/shared';
import type {
  AuthResult,
  DeviceRepository,
  MailService,
  PasswordHasher,
  SessionView,
  TokenService,
  UserRecord,
  UserRepository,
  UserSettingsRecord,
} from './types.js';
import type { SessionService } from './session.service.js';
import type { VerificationService } from './verification.service.js';

export interface AuthServiceOptions {
  userRepository: UserRepository;
  deviceRepository: DeviceRepository;
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
  sessionService: SessionService;
  verificationService: VerificationService;
  mailService: MailService;
  appBaseUrl: string;
  now?: () => Date;
}

export interface RegisterInput {
  email: string;
  password: string;
  username: string;
  displayName?: string;
  locale?: string;
  deviceId: string;
  platform: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
  deviceId: string;
  platform: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface RefreshInput {
  refreshToken: string;
  deviceId: string;
  ip?: string | null;
  userAgent?: string | null;
}

/** Orchestrates register / login / refresh / logout / verify / reset / profile. */
export class AuthService {
  private readonly options: AuthServiceOptions;

  constructor(options: AuthServiceOptions) {
    this.options = options;
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const email = input.email.toLowerCase();
    const existingEmail = await this.options.userRepository.findByEmail(email);
    if (existingEmail) {
      throw new ConflictError('An account with this email already exists');
    }
    const existingUsername = await this.options.userRepository.findByUsername(input.username);
    if (existingUsername) {
      throw new ConflictError('This username is already taken');
    }

    const passwordHash = await this.options.passwordHasher.hash(input.password);
    const user = await this.options.userRepository.create({
      id: ulid(),
      email,
      passwordHash,
      username: input.username,
      displayName: input.displayName ?? null,
      locale: input.locale ?? 'en',
    });

    const { token } = await this.options.verificationService.issue(user.id, 'EMAIL_VERIFY');
    const verificationUrl = `${this.options.appBaseUrl}/auth/verify-email?token=${encodeURIComponent(token)}`;
    await this.options.mailService.sendVerificationEmail(user.email, verificationUrl);

    await this.options.deviceRepository.upsert({
      userId: user.id,
      deviceId: input.deviceId,
      platform: input.platform,
    });

    const result = await this.issueSession(
      user,
      input.deviceId,
      input.ip ?? null,
      input.userAgent ?? null,
    );
    return result;
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const email = input.email.toLowerCase();
    const user = await this.options.userRepository.findByEmail(email);
    if (!user) {
      await this.options.passwordHasher.hash('dummy-password-for-timing');
      throw new UnauthorizedError('Invalid email or password');
    }

    const valid = await this.options.passwordHasher.verify(user.passwordHash, input.password);
    if (!valid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (user.status === 'SUSPENDED') {
      throw new SincError(ErrorCodes.ACCOUNT_SUSPENDED, 'Your account has been suspended', {
        details: { reason: user.statusReason },
      });
    }
    if (user.status === 'PENDING_DELETION' || user.status === 'DELETED') {
      throw new UnauthorizedError('Invalid email or password');
    }
    if (!user.emailVerified) {
      throw new SincError(
        ErrorCodes.EMAIL_NOT_VERIFIED,
        'Please verify your email before logging in',
      );
    }

    const device = await this.options.deviceRepository.upsert({
      userId: user.id,
      deviceId: input.deviceId,
      platform: input.platform,
    });

    const priorSessions = await this.options.sessionService.listForUser(user.id);
    const isNewDevice =
      priorSessions.length === 0 || !priorSessions.some((s) => s.deviceId === input.deviceId);
    if (isNewDevice) {
      await this.options.mailService.sendSecurityAlert(
        user.email,
        `A new device (${input.platform}) signed in to your account. If this was not you, change your password immediately.`,
      );
    }
    void device;

    await this.options.userRepository.updateLastLogin(
      user.id,
      new Date().toISOString(),
      input.ip ?? null,
    );
    return this.issueSession(user, input.deviceId, input.ip ?? null, input.userAgent ?? null);
  }

  async refresh(input: RefreshInput): Promise<AuthResult> {
    const hash = this.options.tokenService.hashRefreshToken(input.refreshToken);
    const { user } = await this.options.sessionService.rotate(
      hash,
      input.deviceId,
      input.ip ?? null,
      input.userAgent ?? null,
    );
    const access = await this.options.tokenService.issueAccessToken(user.id, user.role);
    const refresh = this.options.tokenService.issueRefreshToken();
    await this.options.sessionService.createSession(
      user.id,
      refresh.hash,
      input.deviceId,
      input.ip ?? null,
      input.userAgent ?? null,
    );
    return this.buildResult(user, access.token, refresh.token, access.expiresIn);
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = this.options.tokenService.hashRefreshToken(refreshToken);
    await this.options.sessionService.revokeByRefreshHash(hash);
  }

  async verifyEmail(token: string, deviceId: string, platform: string): Promise<AuthResult> {
    const { userId } = await this.options.verificationService.consume(token, 'EMAIL_VERIFY');
    const user = await this.requireUser(userId);
    await this.options.userRepository.setEmailVerified(user.id, new Date().toISOString());
    await this.options.deviceRepository.upsert({
      userId: user.id,
      deviceId,
      platform,
    });
    return this.issueSession(user, deviceId, null, null);
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.options.userRepository.findByEmail(email.toLowerCase());
    if (!user || user.emailVerified || user.status !== 'ACTIVE') return;
    const { token } = await this.options.verificationService.issue(user.id, 'EMAIL_VERIFY');
    const verificationUrl = `${this.options.appBaseUrl}/auth/verify-email?token=${encodeURIComponent(token)}`;
    await this.options.mailService.sendVerificationEmail(user.email, verificationUrl);
  }

  async requestPasswordReset(email: string): Promise<void> {
    // Always completes without leaking whether the email exists.
    const user = await this.options.userRepository.findByEmail(email.toLowerCase());
    if (!user || user.status !== 'ACTIVE') return;
    const { token } = await this.options.verificationService.issue(user.id, 'PASSWORD_RESET');
    const resetUrl = `${this.options.appBaseUrl}/auth/password-reset/confirm?token=${encodeURIComponent(token)}`;
    await this.options.mailService.sendPasswordResetEmail(user.email, resetUrl);
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const { userId } = await this.options.verificationService.consume(token, 'PASSWORD_RESET');
    const user = await this.requireUser(userId);
    if (user.status !== 'ACTIVE') {
      throw new SincError(ErrorCodes.FORBIDDEN, 'Account is not active');
    }
    const passwordHash = await this.options.passwordHasher.hash(newPassword);
    await this.options.userRepository.update(user.id, { passwordHash });
    await this.options.sessionService.revokeAllForUser(user.id);
  }

  async getMe(userId: string): Promise<{ user: UserRecord; settings: UserSettingsRecord }> {
    const user = await this.requireActiveUser(userId);
    const settings = await this.options.userRepository.getSettings(userId);
    return { user, settings };
  }

  async updateProfile(
    userId: string,
    patch: {
      displayName?: string;
      username?: string;
      avatarUrl?: string | null;
      locale?: string;
    },
  ): Promise<UserRecord> {
    const user = await this.requireActiveUser(userId);
    if (patch.username && patch.username !== user.username) {
      const taken = await this.options.userRepository.findByUsername(patch.username);
      if (taken && taken.id !== user.id) {
        throw new ConflictError('This username is already taken');
      }
    }
    const updated = await this.options.userRepository.update(userId, patch as Partial<UserRecord>);
    return updated;
  }

  async updateSettings(
    userId: string,
    patch: Partial<
      Pick<
        UserSettingsRecord,
        'playback' | 'downloads' | 'lyrics' | 'appearance' | 'privacy' | 'security' | 'dataSaver'
      >
    >,
  ): Promise<UserSettingsRecord> {
    await this.requireActiveUser(userId);
    return this.options.userRepository.updateSettings(userId, patch);
  }

  async deleteAccount(userId: string, password: string, confirmation: string): Promise<void> {
    if (confirmation !== 'DELETE') {
      throw new ValidationError('Type DELETE to confirm account deletion');
    }
    const user = await this.requireActiveUser(userId);
    const valid = await this.options.passwordHasher.verify(user.passwordHash, password);
    if (!valid) {
      throw new UnauthorizedError('Invalid password');
    }
    await this.options.userRepository.markPendingDeletion(user.id);
    await this.options.sessionService.revokeAllForUser(user.id);
  }

  async listSessions(userId: string, currentSessionId?: string): Promise<SessionView[]> {
    return this.options.sessionService.listForUser(userId, currentSessionId);
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    await this.options.sessionService.revokeSession(userId, sessionId);
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.options.sessionService.revokeAllForUser(userId);
  }

  // ---------- internals ----------

  private async issueSession(
    user: UserRecord,
    deviceId: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<AuthResult> {
    const access = await this.options.tokenService.issueAccessToken(user.id, user.role);
    const refresh = this.options.tokenService.issueRefreshToken();
    await this.options.sessionService.createSession(user.id, refresh.hash, deviceId, ip, userAgent);
    return this.buildResult(user, access.token, refresh.token, access.expiresIn);
  }

  private buildResult(
    user: UserRecord,
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ): AuthResult {
    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role as Role,
        createdAt: user.createdAt,
      },
      accessToken,
      refreshToken,
      expiresIn,
    };
  }

  private async requireUser(userId: string): Promise<UserRecord> {
    const user = await this.options.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user;
  }

  private async requireActiveUser(userId: string): Promise<UserRecord> {
    const user = await this.requireUser(userId);
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Account is not active');
    }
    return user;
  }
}
