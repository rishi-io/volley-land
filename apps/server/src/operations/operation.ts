import { DiscoveryService } from '@nestjs/core';
import type { z } from 'zod';

/**
 * Who is acting. Today an admin REST caller holds the shared ADMIN_TOKEN (or is anonymous in
 * development) and an MCP caller is anonymous, keyed by network address. The holistic auth layer
 * will put an account here; operations already take an Actor, so they will not change.
 */
export type Principal = { kind: 'anonymous'; key: string } | { kind: 'admin-token' };

export interface Actor {
  /** One per request; in every audit line, so an error can be traced through the log. */
  requestId: string;
  principal: Principal;
  /** What this actor may do: write operations are refused to (and hidden from) 'read' actors. */
  access: 'read' | 'write';
  /** The transport the request came in on. */
  via: 'rest' | 'mcp';
  userAgent: string | null;
}

export const describePrincipal = (principal: Principal): string =>
  principal.kind === 'anonymous' ? `anonymous:${principal.key}` : principal.kind;

/**
 * One admin action, written once and run by every transport: the admin REST API and the MCP
 * server both call it through OperationRunner, so neither holds admin logic of its own.
 *
 * The input schema is the whole contract: the runner validates against it, and MCP clients see
 * it (field descriptions included) as the tool's input schema. A rejected request throws
 * OperationError; anything else thrown is a bug.
 */
export interface Operation<Input extends z.ZodObject = z.ZodObject, Output = unknown> {
  /** snake_case and unique. MCP clients and saved prompts call it by name, so treat it as API. */
  name: string;
  title: string;
  /** Written for a model choosing a tool: what it does, when to use it, what to pass. */
  description: string;
  input: Input;
  /** 'write' changes state. */
  access: 'read' | 'write';
  /** Deletes or irreversibly replaces data (MCP destructiveHint). Only for writes. */
  destructive?: boolean;
  /** Repeating the same call has no further effect (MCP idempotentHint). Reads are idempotent. */
  idempotent?: boolean;
  run(input: z.output<Input>, actor: Actor): Output | Promise<Output>;
  /** What MCP clients are shown instead of the full output, e.g. a world summary rather than every prop. */
  summarize?(output: Output): unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a list holds operations of every input and output type
export type AnyOperation = Operation<any, any>;

/** Keeps the input type flowing from the schema into run(). */
export const defineOperation = <Input extends z.ZodObject, Output>(operation: Operation<Input, Output>): Operation<Input, Output> => operation;

export interface OperationIssue {
  path: string;
  message: string;
}

/**
 * A request an operation refuses, with a message meant for the caller. REST maps the kind to an
 * HTTP status; MCP returns the message as a tool error the model can act on.
 */
export class OperationError extends Error {
  constructor(
    readonly kind: 'invalid' | 'conflict' | 'not_found' | 'forbidden' | 'unavailable',
    message: string,
    readonly issues: OperationIssue[] = [],
  ) {
    super(message);
  }
}

export const issuesOf = (error: z.ZodError, prefix: readonly PropertyKey[] = []): OperationIssue[] =>
  error.issues.map((issue) => ({ path: [...prefix, ...issue.path].map(String).join('.'), message: issue.message }));

/** A provider of operations. Mark it @Operations() and register it in its domain module. */
export interface OperationProvider {
  operations(): AnyOperation[];
}

/** Marks an OperationProvider for discovery by OperationCatalog, wherever its module lives. */
export const Operations = DiscoveryService.createDecorator<void>();
