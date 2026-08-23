import { createHash, randomUUID } from 'node:crypto';
import { AuthenticationError, ConflictError, type CanonicalUser } from '@sinc/shared';
import type { User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getEnv } from '../../config/env.js';
import { hashPassword, verifyPassword } from './password.js';
import type { TokenService } from './tokens.js';
import { toCanonicalUser } from './serializers.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse {
  user: CanonicalUser;
  tokens: AuthTokens;
}

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) return 60_000;
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return amount * unitMs;
}

export class AuthService {
  constructor(private readonly tokens: TokenService) {}

  async register(input: RegisterInput, userAgent?: string, ip?: string): Promise<AuthResponse> {
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { username: input.username }] },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError('An account with this email or username already exists');
    }

    const user = await prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        displayName: input.displayName ?? null,
        passwordHash: await hashPassword(input.password),
      },
    });

    return this.establishSession(user, userAgent, ip);
  }

  async login(input: LoginInput, userAgent?: string, ip?: string): Promise<AuthResponse> {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new AuthenticationError('Invalid email or password');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.establishSession(user, userAgent, ip);
  }

  async refresh(refreshToken: string, userAgent?: string, ip?: string): Promise<AuthResponse> {
    const payload = await this.tokens.verifyRefreshToken(refreshToken);

    const session = await prisma.session.findUnique({ where: { id: payload.sid } });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      session.userId !== payload.sub
    ) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    if (session.refreshToken !== this.hashRefreshToken(refreshToken)) {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    const env = getEnv();
    const rotated = await this.tokens.createRefreshToken(user.id, session.id);
    await prisma.session.update({
      where: { id: session.id },
      data: {
        refreshToken: this.hashRefreshToken(rotated),
        expiresAt: new Date(Date.now() + parseDuration(env.JWT_REFRESH_TTL)),
        userAgent: userAgent ?? session.userAgent,
        ipAddress: ip ?? session.ipAddress,
      },
    });

    const accessToken = await this.tokens.createAccessToken(
      user.id,
      session.id,
      user.role as 'user' | 'admin',
      user.status as 'active' | 'suspended'
    );
    return this.response(user, accessToken, rotated);
  }
  async logout(sessionId: string): Promise<void> {
    await prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutWithRefreshToken(refreshToken: string): Promise<void> {
    const payload = await this.tokens.verifyRefreshToken(refreshToken);
    await this.logout(payload.sid);
  }

  async me(userId: string): Promise<CanonicalUser> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AuthenticationError('User not found');
    return toCanonicalUser(user);
  }

  private async establishSession(
    user: User,
    userAgent?: string,
    ip?: string
  ): Promise<AuthResponse> {
    const env = getEnv();
    const sessionId = randomUUID();
    const accessToken = await this.tokens.createAccessToken(
      user.id,
      sessionId,
      user.role as 'user' | 'admin',
      user.status as 'active' | 'suspended'
    );
    const refreshToken = await this.tokens.createRefreshToken(user.id, sessionId);

    await prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshToken: this.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + parseDuration(env.JWT_REFRESH_TTL)),
        userAgent,
        ipAddress: ip,
      },
    });

    return this.response(user, accessToken, refreshToken);
  }

  private response(user: User, accessToken: string, refreshToken: string): AuthResponse {
    return {
      user: toCanonicalUser(user),
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: parseDuration(getEnv().JWT_ACCESS_TTL) / 1000,
      },
    };
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
