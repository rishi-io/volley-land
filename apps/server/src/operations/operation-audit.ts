import { Injectable, Logger } from '@nestjs/common';
import { type Actor, describePrincipal } from './operation.js';

export type OperationOutcome = 'ok' | 'invalid' | 'rejected' | 'forbidden' | 'timeout' | 'failed';

/**
 * One key=value log line per operation call, whichever transport it came in on. Inputs and
 * outputs are never logged: they hold whole settings sections and worlds.
 */
@Injectable()
export class OperationAuditLog {
  private readonly logger = new Logger('OperationAudit');

  call(actor: Actor, operation: string, outcome: OperationOutcome, durationMs: number): void {
    const line = `op.call op=${operation} via=${actor.via} outcome=${outcome} ms=${durationMs.toFixed(1)} ${whoIs(actor)}`;
    if (outcome === 'failed') this.logger.error(line);
    else if (outcome === 'ok') this.logger.log(line);
    else this.logger.warn(line);
  }
}

/** The actor part of an audit line. */
export function whoIs(actor: Actor): string {
  const agent = actor.userAgent ? ` agent=${JSON.stringify(actor.userAgent.slice(0, 120))}` : '';
  return `access=${actor.access} principal=${describePrincipal(actor.principal)} request=${actor.requestId}${agent}`;
}
