import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { ConflictError, UnauthorizedError, ErrorCodes } from '@sinc/shared';
import { PasswordHasherService } from '../domain/auth/password.service.js';
import { TokenServiceJose } from '../domain/auth/token.service.js';
import { SessionService } from '../domain/auth/session.service.js';
import { VerificationService } from '../domain/auth/verification.service.js';
import { AuthService } from '../domain/auth/auth.service.js';
import {
  MemoryUserRepository,
  MemorySessionRepository,
  MemoryDeviceRepository,
  MemoryVerificationTokenRepository,
  MemoryNotificationRepository,
  MemoryMailService,
} from '../persistence/memory-repos.js';

interface Stack {
  auth: AuthService;
  users: MemoryUserRepository;
  sessions: MemorySessionRepository;
  verification: VerificationService;
  mail: MemoryMailService;
  tokenService: TokenServiceJose;
}

async function buildStack(): Promise<Stack> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const tokenService = new TokenServiceJose(
    await exportPKCS8(privateKey),
    await exportSPKI(publicKey),
    900,
  );
  const users = new MemoryUserRepository();
  const sessions = new MemorySessionRepository();
  const devices = new MemoryDeviceRepository();
  const verificationTokens = new MemoryVerificationTokenRepository();
  const notifications = new MemoryNotificationRepository();
  const mail = new MemoryMailService();

  const sessionService = new SessionService({
    userRepository: users,
    sessionRepository: sessions,
    notificationRepository: notifications,
    refreshTtlDays: 30,
  });
  const verification = new VerificationService({
    verificationTokenRepository: verificationTokens,
    emailVerifyTtlHours: 24,
    passwordResetTtlMinutes: 30,
  });
  const auth = new AuthService({
    userRepository: users,
    deviceRepository: devices,
    passwordHasher: new PasswordHasherService(),
    tokenService,
    sessionService,
    verificationService: verification,
    mailService: mail,
    appBaseUrl: 'https://sinc.app',
  });

  return { auth, users, sessions, verification, mail, tokenService };
}

const REGISTER_INPUT = {
  email: 'user@example.com',
  password: 'Str0ng!Passw0rd',
  username: 'musicfan',
  displayName: 'Music Fan',
  locale: 'en',
  deviceId: 'device-1',
  platform: 'ios',
};

async function registerAndVerify(stack: Stack) {
  await stack.auth.register(REGISTER_INPUT);
  const verifyToken = stack.mail.lastUrl('verify').split('token=')[1]!;
  const verified = await stack.auth.verifyEmail(verifyToken, 'device-1', 'ios');
  return { registerResult: verified, verified };
}

describe('auth lifecycle', () => {
  let stack: Stack;

  beforeEach(async () => {
    stack = await buildStack();
  });

  it('registers, sends verification email, and starts unverified', async () => {
    const result = await stack.auth.register(REGISTER_INPUT);
    expect(result.user.email).toBe('user@example.com');
    expect(result.user.role).toBe('USER');
    expect(result.refreshToken).toBeTruthy();
    expect(stack.mail.sent).toHaveLength(1);
    expect(stack.mail.sent[0]!.kind).toBe('verify');
    expect(stack.mail.sent[0]!.url).toContain('/auth/verify-email?token=');

    const user = await stack.users.findByEmail('user@example.com');
    expect(user!.emailVerified).toBe(false);
    expect(user!.status).toBe('ACTIVE');
  });

  it('rejects duplicate email and username with conflict', async () => {
    await stack.auth.register(REGISTER_INPUT);
    await expect(
      stack.auth.register({ ...REGISTER_INPUT, username: 'other' }),
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT });
    await expect(
      stack.auth.register({ ...REGISTER_INPUT, email: 'other@example.com' }),
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT });
  });

  it('blocks login until email is verified', async () => {
    await stack.auth.register(REGISTER_INPUT);
    await expect(
      stack.auth.login({
        email: REGISTER_INPUT.email,
        password: REGISTER_INPUT.password,
        deviceId: 'device-1',
        platform: 'ios',
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.EMAIL_NOT_VERIFIED });
  });

  it('verifies email with the emailed token', async () => {
    await stack.auth.register(REGISTER_INPUT);
    const verifyToken = stack.mail.lastUrl('verify').split('token=')[1]!;
    const result = await stack.auth.verifyEmail(verifyToken, 'device-1', 'ios');
    expect(result.user.id).toBeTruthy();
    const user = await stack.users.findByEmail(REGISTER_INPUT.email);
    expect(user!.emailVerified).toBe(true);
    expect(user!.emailVerifiedAt).toBeTruthy();
  });

  it('rejects a second use of the same verification token', async () => {
    await stack.auth.register(REGISTER_INPUT);
    const verifyToken = stack.mail.sent[0]!.url!.split('token=')[1]!;
    await stack.auth.verifyEmail(verifyToken, 'device-1', 'ios');
    await expect(stack.auth.verifyEmail(verifyToken, 'device-1', 'ios')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('logs in with correct credentials and returns tokens', async () => {
    await registerAndVerify(stack);
    const login = await stack.auth.login({
      email: REGISTER_INPUT.email,
      password: REGISTER_INPUT.password,
      deviceId: 'device-1',
      platform: 'ios',
    });
    expect(login.accessToken).toBeTruthy();
    expect(login.expiresIn).toBe(900);
    expect(login.user.username).toBe('musicfan');
    expect(stack.mail.sent.filter((m) => m.kind === 'security')).toHaveLength(0);
  });

  it('rejects wrong password and unknown email identically', async () => {
    await registerAndVerify(stack);
    await expect(
      stack.auth.login({
        email: REGISTER_INPUT.email,
        password: 'wrong-pass',
        deviceId: 'device-1',
        platform: 'ios',
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.UNAUTHORIZED,
      message: 'Invalid email or password',
    });
    await expect(
      stack.auth.login({
        email: 'ghost@example.com',
        password: 'whatever-12345',
        deviceId: 'device-1',
        platform: 'ios',
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.UNAUTHORIZED,
      message: 'Invalid email or password',
    });
  });

  it('notifies on login from a new device', async () => {
    await registerAndVerify(stack);
    await stack.auth.login({
      email: REGISTER_INPUT.email,
      password: REGISTER_INPUT.password,
      deviceId: 'device-2',
      platform: 'android',
    });
    const alerts = stack.mail.sent.filter((m) => m.kind === 'security');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toContain('android');
  });

  it('rotates refresh tokens and revokes the old one', async () => {
    const { verified } = await registerAndVerify(stack);
    const oldRefresh = verified.refreshToken;

    const refreshed = await stack.auth.refresh({
      refreshToken: oldRefresh,
      deviceId: 'device-1',
    });
    expect(refreshed.refreshToken).not.toBe(oldRefresh);

    const hash = stack.tokenService.hashRefreshToken(oldRefresh);
    const oldSession = await stack.sessions.findByRefreshHash(hash);
    expect(oldSession!.revokedAt).toBeTruthy();
    expect(oldSession!.revokedBy).toBe('rotated');
  });

  it('detects refresh-token reuse and revokes all sessions', async () => {
    const { verified } = await registerAndVerify(stack);
    const firstRefresh = verified.refreshToken;
    const rotated = await stack.auth.refresh({ refreshToken: firstRefresh, deviceId: 'device-1' });

    // Second rotation consumes the first token
    await stack.auth.refresh({ refreshToken: rotated.refreshToken, deviceId: 'device-1' });

    // Now the ORIGINAL token is presented again -> reuse detection
    await expect(
      stack.auth.refresh({ refreshToken: firstRefresh, deviceId: 'device-1' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    const user = await stack.users.findByEmail(REGISTER_INPUT.email);
    const remaining = (await stack.sessions.listForUser(user!.id)).filter((s) => !s.revokedAt);
    expect(remaining).toHaveLength(0);
  });

  it('logs out and the refresh token stops working', async () => {
    const { verified } = await registerAndVerify(stack);
    await stack.auth.logout(verified.refreshToken);
    await expect(
      stack.auth.refresh({ refreshToken: verified.refreshToken, deviceId: 'device-1' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('resends verification for an unverified account', async () => {
    await stack.auth.register(REGISTER_INPUT);
    await stack.auth.resendVerification(REGISTER_INPUT.email);
    expect(stack.mail.sent.filter((m) => m.kind === 'verify')).toHaveLength(2);
  });

  it('password reset flow: request -> confirm -> old sessions revoked, new password works', async () => {
    const { verified } = await registerAndVerify(stack);
    const refreshBeforeReset = verified.refreshToken;

    await stack.auth.requestPasswordReset(REGISTER_INPUT.email);
    const resetMail = stack.mail.lastUrl('reset');
    expect(resetMail).toContain('/auth/password-reset/confirm?token=');
    const resetToken = resetMail.split('token=')[1]!;

    await stack.auth.confirmPasswordReset(resetToken, 'NewStrongPassw0rd!');

    // old refresh token revoked by reset
    await expect(
      stack.auth.refresh({ refreshToken: refreshBeforeReset, deviceId: 'device-1' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    // new password works
    const login = await stack.auth.login({
      email: REGISTER_INPUT.email,
      password: 'NewStrongPassw0rd!',
      deviceId: 'device-1',
      platform: 'ios',
    });
    expect(login.accessToken).toBeTruthy();
  });

  it('password reset request does not leak whether an email exists', async () => {
    await stack.auth.requestPasswordReset('nobody@example.com');
    expect(stack.mail.sent).toHaveLength(0);
  });

  it('rejects password reset token reuse', async () => {
    await registerAndVerify(stack);
    await stack.auth.requestPasswordReset(REGISTER_INPUT.email);
    const resetToken = stack.mail.lastUrl('reset').split('token=')[1]!;
    await stack.auth.confirmPasswordReset(resetToken, 'NewStrongPassw0rd!');
    await expect(
      stack.auth.confirmPasswordReset(resetToken, 'AnotherStrongPassw0rd!'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('lists sessions and marks the current one', async () => {
    const { verified } = await registerAndVerify(stack);
    await stack.auth.login({
      email: REGISTER_INPUT.email,
      password: REGISTER_INPUT.password,
      deviceId: 'device-2',
      platform: 'android',
    });
    const user = await stack.users.findByEmail(REGISTER_INPUT.email);

    // find the second session id
    const sessions = await stack.auth.listSessions(user!.id);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    const second = sessions.find((s) => s.deviceId === 'device-2')!;
    expect(second.isCurrent).toBe(false);
    void verified;
  });

  it('revokes a specific session and all sessions', async () => {
    await registerAndVerify(stack);
    await stack.auth.login({
      email: REGISTER_INPUT.email,
      password: REGISTER_INPUT.password,
      deviceId: 'device-2',
      platform: 'android',
    });
    const user = await stack.users.findByEmail(REGISTER_INPUT.email);
    const sessions = await stack.auth.listSessions(user!.id);
    const target = sessions.find((s) => s.deviceId === 'device-2')!;

    await stack.auth.revokeSession(user!.id, target.id);
    const after = await stack.auth.listSessions(user!.id);
    expect(after.find((s) => s.id === target.id)).toBeUndefined();

    await stack.auth.revokeAllSessions(user!.id);
    const final = await stack.auth.listSessions(user!.id);
    expect(final).toHaveLength(0);
  });

  it('updates profile and rejects taken usernames', async () => {
    const { registerResult } = await registerAndVerify(stack);
    const updated = await stack.auth.updateProfile(registerResult.user.id, {
      displayName: 'New Name',
      username: 'newfan',
    });
    expect(updated.displayName).toBe('New Name');
    expect(updated.username).toBe('newfan');

    await stack.auth.register({ ...REGISTER_INPUT, email: 'other@example.com', username: 'taken' });
    await expect(
      stack.auth.updateProfile(registerResult.user.id, { username: 'taken' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('updates and merges settings', async () => {
    const { registerResult } = await registerAndVerify(stack);
    const first = await stack.auth.updateSettings(registerResult.user.id, {
      playback: { volumeNormalization: true },
    });
    expect(first.playback.volumeNormalization).toBe(true);
    const second = await stack.auth.updateSettings(registerResult.user.id, {
      playback: { crossfade: 5 },
    });
    expect(second.playback).toEqual({ volumeNormalization: true, crossfade: 5 });
  });

  it('deletes account with correct password and confirmation', async () => {
    const { registerResult } = await registerAndVerify(stack);
    await stack.auth.deleteAccount(registerResult.user.id, 'Str0ng!Passw0rd', 'DELETE');
    const user = await stack.users.findById(registerResult.user.id);
    expect(user!.status).toBe('PENDING_DELETION');
    expect(user!.deletedAt).toBeTruthy();
  });

  it('rejects account deletion with wrong password', async () => {
    const { registerResult } = await registerAndVerify(stack);
    await expect(
      stack.auth.deleteAccount(registerResult.user.id, 'wrong-password', 'DELETE'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('blocks login for suspended accounts', async () => {
    const { registerResult } = await registerAndVerify(stack);
    await stack.users.update(registerResult.user.id, { status: 'SUSPENDED', statusReason: 'ToS' });
    await expect(
      stack.auth.login({
        email: REGISTER_INPUT.email,
        password: REGISTER_INPUT.password,
        deviceId: 'device-1',
        platform: 'ios',
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.ACCOUNT_SUSPENDED });
  });
});
