import type { FastifyRequest } from 'fastify';
import { UnauthorizedError, ForbiddenError, type Role } from '@sinc/shared';
import type { TokenService } from '../domain/auth/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; role: Role; jti: string };
  }
}

/** onRequest hook: require a valid Bearer access token. */
export function authGuard(tokenService: TokenService) {
  return async function guard(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing bearer token');
    }
    const claims = await tokenService.verifyAccessToken(header.slice(7));
    if (!claims) {
      throw new UnauthorizedError('Invalid or expired access token');
    }
    request.auth = { userId: claims.sub, role: claims.role, jti: claims.jti };
  };
}

/** onRequest hook: require a valid token AND one of the given roles. */
export function roleGuard(tokenService: TokenService, ...roles: Role[]) {
  const base = authGuard(tokenService);
  return async function guard(request: FastifyRequest): Promise<void> {
    await base(request);
    if (!roles.includes(request.auth!.role)) {
      throw new ForbiddenError('Insufficient role for this operation');
    }
  };
}
