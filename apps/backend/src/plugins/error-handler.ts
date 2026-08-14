import type { FastifyReply, FastifyRequest } from 'fastify';
import { SincError, ValidationError, errorBody, type ErrorDetails } from '@sinc/shared';
import { ZodError } from 'zod';

/**
 * Central error -> API envelope mapping. Guarantees every error response has
 * the shape defined in ARCHITECTURE_API.md (success:false + code + message).
 */
export function errorHandler(err: Error, request: FastifyRequest, reply: FastifyReply): void {
  const requestId = request.id;

  if (err instanceof ZodError) {
    const details: ErrorDetails = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '<root>';
      const list = (details[key] as unknown[] | undefined) ?? [];
      list.push(issue.message);
      details[key] = list;
    }
    const wrapped = new ValidationError('Invalid request payload', details);
    reply
      .status(wrapped.status)
      .send(errorBody(wrapped.code, wrapped.message, requestId, wrapped.details));
    return;
  }

  if (err instanceof SincError) {
    reply.status(err.status).send(errorBody(err.code, err.message, requestId, err.details));
    return;
  }

  if (
    (err as { code?: string }).code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ||
    (err as { code?: string }).code === 'FST_ERR_CTP_INVALID_JSON_BODY'
  ) {
    reply.status(400).send(errorBody('VALIDATION_ERROR', err.message, requestId));
    return;
  }

  request.log.error({ err }, 'Unhandled error');
  reply.status(500).send(errorBody('INTERNAL_ERROR', 'Internal server error', requestId));
}
