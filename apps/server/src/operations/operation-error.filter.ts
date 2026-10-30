import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { AdminError } from '@volleyland/contracts';
import { OperationError } from './operation.js';

const STATUS: Record<OperationError['kind'], number> = {
  invalid: HttpStatus.BAD_REQUEST,
  forbidden: HttpStatus.FORBIDDEN,
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  unavailable: HttpStatus.SERVICE_UNAVAILABLE,
};

/** An operation's refusal as an HTTP error with an AdminError body. */
@Catch(OperationError)
export class OperationErrorFilter implements ExceptionFilter {
  catch(error: OperationError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<{ status(code: number): { json(body: unknown): void } }>();
    const body: AdminError = { error: error.kind, message: error.message, ...(error.issues.length > 0 ? { issues: error.issues } : {}) };
    res.status(STATUS[error.kind]).json(body);
  }
}
