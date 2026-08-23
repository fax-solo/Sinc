import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticationError, AuthorizationError } from '@sinc/shared';
import type { TokenService } from '../modules/auth/tokens.js';

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
  try {
    const payload = await tokenService.verifyAccessToken(token);
    return {
      userId: payload.sub,
      sessionId: payload.sid,
      // Tokens issued before roles existed carry no claims; treat them as a
      // regular active user until the next refresh re-issues the token.
      role: payload.role ?? 'user',
      status: payload.status ?? 'active',
    };
  } catch {
    throw new AuthenticationError('Invalid or expired token');
  }
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
