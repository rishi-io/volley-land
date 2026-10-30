import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OperationAuditLog } from './operation-audit.js';
import { OperationRunner } from './operation-runner.service.js';
import { type Actor, OperationError, defineOperation } from './operation.js';

const actor = (access: Actor['access'] = 'write'): Actor => ({
  requestId: 'req-1',
  principal: { kind: 'anonymous', key: '127.0.0.1' },
  access,
  via: 'rest',
  userAgent: null,
});

const echo = defineOperation({
  name: 'echo',
  title: 'Echo',
  description: 'Echo a count.',
  input: z.object({ count: z.int().min(1) }).refine((i) => i.count !== 13, { path: ['count'], message: 'unlucky' }),
  access: 'read',
  run: ({ count }) => ({ count }),
});

const writeOp = <T>(name: string, run: () => T) => defineOperation({ name, title: name, description: 'Writes.', input: z.object({}), access: 'write', run });
const write = writeOp('write', () => 'written');

function runner(timeoutMs = 100): { runner: OperationRunner; calls: unknown[][] } {
  const audit = new OperationAuditLog();
  const calls: unknown[][] = [];
  vi.spyOn(audit, 'call').mockImplementation((...args) => void calls.push(args));
  return { runner: new OperationRunner({ timeoutMs }, audit), calls };
}

const refusal = async (promise: Promise<unknown>): Promise<OperationError> => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(OperationError);
  return error as OperationError;
};

afterEach(() => vi.restoreAllMocks());

describe('OperationRunner', () => {
  it('validates input with the full schema, refinements included, and returns the output', async () => {
    const { runner: r, calls } = runner();
    expect(await r.run(echo, { count: 2 }, actor())).toEqual({ count: 2 });
    const bad = await refusal(r.run(echo, { count: 13 }, actor()));
    expect(bad).toMatchObject({ kind: 'invalid', issues: [{ path: 'count', message: 'unlucky' }] });
    expect(calls.map((c) => [c[1], c[2]])).toEqual([
      ['echo', 'ok'],
      ['echo', 'invalid'],
    ]);
  });

  it('refuses writes to read-only actors before running them', async () => {
    const { runner: r, calls } = runner();
    expect(await refusal(r.run(write, {}, actor('read')))).toMatchObject({ kind: 'forbidden' });
    expect(await r.run(write, {}, actor('write'))).toBe('written');
    expect(calls.map((c) => c[2])).toEqual(['forbidden', 'ok']);
  });

  it('passes refusals on, turns a ZodError inside run into invalid input, and times out slow work', async () => {
    const { runner: r, calls } = runner(20);
    const conflict = writeOp('conflict', () => Promise.reject(new OperationError('conflict', 'stale')));
    expect(await refusal(r.run(conflict, {}, actor()))).toMatchObject({ kind: 'conflict', message: 'stale' });
    const zod = writeOp('zod', () => z.int().parse('x'));
    expect(await refusal(r.run(zod, {}, actor()))).toMatchObject({ kind: 'invalid' });
    const slow = writeOp('slow', () => new Promise(() => {}));
    const timeout = await refusal(r.run(slow, {}, actor()));
    expect(timeout.kind).toBe('unavailable');
    expect(timeout.message).toContain('read the current state before retrying');
    expect(calls.map((c) => c[2])).toEqual(['rejected', 'invalid', 'timeout']);
  });

  it('logs a bug with the request ID and rethrows it as is', async () => {
    const { runner: r, calls } = runner();
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const bug = new Error('boom');
    const crash = writeOp('crash', () => {
      throw bug;
    });
    await expect(r.run(crash, {}, actor())).rejects.toBe(bug);
    expect(calls.map((c) => c[2])).toEqual(['failed']);
    expect(String(errors.mock.calls[0]?.[0])).toContain('request req-1');
  });
});
