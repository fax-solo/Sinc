import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticationError, AuthorizationError } from '@sinc/shared';
import type { TokenService } from '../modules/auth/tokens.js';
import { prisma } from '../lib/prisma.js';

export interface AuthenticatedRequest extends FastifyRequest {
  auth: {
    userId: string;
    sessionId: string;
    role: string;
    status: string;
  };
}

interface GuardOptions {
  /** Reject suspended users (default true). */
  rejectSuspended?: boolean;
}

async function resolveAuth(
  request: FastifyRequest,
  tokenService: TokenService
): Promise<AuthenticatedRequest['auth']> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthenticationError('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);
  let payload: { sub: string; sid: string };
  try {
    payload = await tokenService.verifyAccessToken(token);
  } catch {
    throw new AuthenticationError('Invalid or expired token');
  }

  // Roles/status are read from the database on every request so that
  // suspensions, session revocations, deletions and re-issued tokens take
  // effect immediately instead of being deferred to the next token refresh.
  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: true },
  });
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt < new Date() ||
    session.userId !== payload.sub
  ) {
    throw new AuthenticationError('Invalid or expired session');
  }

  return {
    userId: session.userId,
    sessionId: session.id,
    role: session.user.role,
    status: session.user.status,
  };
}

export function authGuard(tokenService: TokenService, options: GuardOptions = {}) {
  const { rejectSuspended = true } = options;
  return async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const auth = await resolveAuth(request, tokenService);
    if (rejectSuspended && auth.status !== 'active') {
      throw new AuthorizationError('Account suspended');
    }
    (request as AuthenticatedRequest).auth = auth;
  };
}

export function adminGuard(tokenService: TokenService) {
  return async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const auth = await resolveAuth(request, tokenService);
    if (auth.role !== 'admin') {
      throw new AuthorizationError('Administrator privileges required');
    }
    if (auth.status !== 'active') {
      throw new AuthorizationError('Account suspended');
    }
    (request as AuthenticatedRequest).auth = auth;
  };
}
