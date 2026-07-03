import Fastify, { type FastifyError } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

/** Thrown by runWithTimeout; the shared error handler renders it as a 504. */
export class HandlerTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'HandlerTimeoutError';
  }
}

export interface CreateServerOptions {
  /** Agent name, used for log context. */
  agentName: string;
  /** Max request body size in bytes. Default: 1 MiB. */
  bodyLimit?: number;
  /** Enable Fastify's built-in logger. Default: true. */
  logger?: boolean;
}

/**
 * Build a Fastify instance wired with the Zod type provider and a shared error
 * handler. Routes declared with `schema.body`/`schema.querystring` are validated
 * with Zod; failures are rendered as 400 { error }.
 */
export function createServer(options: CreateServerOptions) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: options.bodyLimit ?? 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof HandlerTimeoutError) {
      reply.status(504).send({ error: error.message });
      return;
    }
    // Zod schema-validation failures and malformed JSON bodies both surface here.
    if (error.validation || error.statusCode === 400) {
      reply.status(400).send({ error: error.message });
      return;
    }
    request.log.error(error, `[${options.agentName}] Unhandled error`);
    reply.status(500).send({ error: 'Internal server error' });
  });

  return app;
}

export type AppInstance = ReturnType<typeof createServer>;

/**
 * Race an async function against a timeout. Rejects with HandlerTimeoutError if
 * `fn` does not settle within `timeoutMs`. The underlying work is not cancelled.
 */
export async function runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HandlerTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
