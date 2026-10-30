import { Inject, Injectable, Logger } from '@nestjs/common';
import { ZodError, type z } from 'zod';
import { OperationAuditLog, type OperationOutcome } from './operation-audit.js';
import { type Actor, type Operation, OperationError, issuesOf } from './operation.js';

export const OPERATIONS_CONFIG = Symbol('OPERATIONS_CONFIG');

export interface OperationsConfig {
  /** A call that takes longer fails as 'unavailable' (the work itself is not cancelled). */
  timeoutMs: number;
}

export const DEFAULT_OPERATIONS_CONFIG: OperationsConfig = { timeoutMs: 15_000 };

const outcomeOf = (error: OperationError): OperationOutcome =>
  error.kind === 'invalid' ? 'invalid' : error.kind === 'forbidden' ? 'forbidden' : error.kind === 'unavailable' ? 'timeout' : 'rejected';

/**
 * The one way into an operation, for every transport: check access, validate the input against
 * the operation's full schema, run it under a timeout, and audit the outcome. Refusals come out
 * as OperationError; a bug is logged here with the request ID and rethrown for the transport to
 * report without its details.
 */
@Injectable()
export class OperationRunner {
  private readonly logger = new Logger(OperationRunner.name);

  constructor(
    @Inject(OPERATIONS_CONFIG) private readonly config: OperationsConfig,
    @Inject(OperationAuditLog) private readonly audit: OperationAuditLog,
  ) {}

  async run<Input extends z.ZodObject, Output>(operation: Operation<Input, Output>, raw: unknown, actor: Actor): Promise<Output> {
    const started = performance.now();
    const finish = (outcome: OperationOutcome) => this.audit.call(actor, operation.name, outcome, performance.now() - started);
    try {
      if (operation.access === 'write' && actor.access !== 'write') {
        throw new OperationError('forbidden', `"${operation.name}" changes data, and this connection is read-only.`);
      }
      const parsed = operation.input.safeParse(raw ?? {});
      if (!parsed.success) throw new OperationError('invalid', 'Invalid input', issuesOf(parsed.error));
      const output = await this.withTimeout(operation, Promise.resolve().then(() => operation.run(parsed.data, actor)));
      finish('ok');
      return output;
    } catch (error) {
      const refusal = error instanceof ZodError ? new OperationError('invalid', 'Invalid input', issuesOf(error)) : error;
      if (refusal instanceof OperationError) {
        finish(outcomeOf(refusal));
        throw refusal;
      }
      finish('failed');
      this.logger.error(`Operation ${operation.name} failed (request ${actor.requestId})`, error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  private async withTimeout<T>(operation: Operation<z.ZodObject, unknown>, work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const retry = operation.access === 'write' ? ' It may still complete: read the current state before retrying.' : '';
        reject(new OperationError('unavailable', `"${operation.name}" did not finish within ${this.config.timeoutMs} ms.${retry}`));
      }, this.config.timeoutMs);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
