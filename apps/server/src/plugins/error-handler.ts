import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { isAppError } from '@sinc/shared';
import { inc } from '../lib/metrics.js';
import { getEnv } from '../config/env.js';

export async function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (error.validation) {
    return reply.status(400).send({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
    });
  }

  if (isAppError(error)) {
    return reply.status(error.status).send({
      status: error.status,
      code: error.code,
      message: error.message,
    });
  }

  request.log.error({ err: error }, 'Unhandled error');
  if (getEnv().METRICS_ENABLED) {
    inc('sinc_http_errors_total', {
      method: request.method,
      route: request.routeOptions.url ?? 'unknown',
    });
  }
  return reply.status(500).send({
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  });
}
