import { Inject, Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { OperationCatalog } from '../operations/operation-catalog.service.js';
import { OperationRunner } from '../operations/operation-runner.service.js';
import { type Actor, type AnyOperation, OperationError, defineOperation, describePrincipal } from '../operations/operation.js';

export const MCP_SERVER_NAME = 'volleyland';
export const MCP_SERVER_VERSION = '0.2.0';

const SERVER_INSTRUCTIONS =
  'Tools for running a Volleyland game server: the same actions as its admin panel. Settings come in sections ' +
  '(get_settings; update_<section>_settings), worlds are built and edited with the world builder tools ' +
  '(get_world_catalogue, create_world, edit_world, check_world), and list_rooms shows live play. Read tools never change ' +
  'anything. Writes use optimistic concurrency: pass the version you last read, and on a conflict read again before ' +
  'retrying. Saved settings reach open rooms at once.';

interface ToolConfig {
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  annotations: ToolAnnotations;
}
type ToolHandler = (args: unknown) => Promise<CallToolResult>;

/**
 * McpServer.registerTool's generics infer the handler's argument type from the schema, which
 * hits "type instantiation is excessively deep" with a schema only known as z.ZodObject. The
 * runner validates the arguments itself, so register through a plain signature.
 */
const registerTool = (server: McpServer, name: string, config: ToolConfig, handler: ToolHandler): void => {
  (server.registerTool.bind(server) as (n: string, c: ToolConfig, h: ToolHandler) => unknown)(name, config, handler);
};

const text = (body: string, isError = false): CallToolResult => ({ content: [{ type: 'text', text: body }], ...(isError ? { isError: true } : {}) });

/** An operation's refusal in words a model can act on. */
const refusal = (error: OperationError): string =>
  error.issues.length === 0 ? error.message : `${error.message}\n${error.issues.map((i) => `- ${i.path || '(root)'}: ${i.message}`).join('\n')}`;

/**
 * The server's operations as MCP tools, plus get_server_info. The transport is stateless, so an
 * McpServer is built for each request with only the tools this actor may use. Every failure is a
 * tool result with isError, never a protocol error, so the model reads it and can recover.
 */
@Injectable()
export class McpToolCatalog {
  private readonly serverInfo: AnyOperation = defineOperation({
    name: 'get_server_info',
    title: 'Server info',
    description: 'Which Volleyland server this is, what this connection may do (read or write), and which tools it has.',
    input: z.object({}),
    access: 'read',
    run: (_input, actor) => ({
      server: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      access: actor.access,
      principal: describePrincipal(actor.principal),
      tools: this.exposedTo(actor).map((t) => ({ name: t.name, access: t.access })),
    }),
  });

  constructor(
    @Inject(OperationCatalog) private readonly operations: OperationCatalog,
    @Inject(OperationRunner) private readonly runner: OperationRunner,
  ) {}

  /** The tools an actor may see and call: write operations only for write access. */
  exposedTo(actor: Actor): AnyOperation[] {
    return [this.serverInfo, ...this.operations.list()].filter((op) => op.access === 'read' || actor.access === 'write');
  }

  buildServer(actor: Actor): McpServer {
    const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
    for (const operation of this.exposedTo(actor)) {
      const write = operation.access === 'write';
      registerTool(
        server,
        operation.name,
        {
          title: operation.title,
          description: operation.description,
          inputSchema: operation.input,
          annotations: {
            title: operation.title,
            readOnlyHint: !write,
            destructiveHint: write && operation.destructive === true,
            idempotentHint: operation.idempotent ?? !write,
            openWorldHint: false,
          },
        },
        (args) => this.call(operation, args, actor),
      );
    }
    return server;
  }

  private async call(operation: AnyOperation, args: unknown, actor: Actor): Promise<CallToolResult> {
    try {
      const output: unknown = await this.runner.run(operation, args, actor);
      const shown = operation.summarize ? operation.summarize(output) : output;
      return text(shown === undefined ? 'Done.' : JSON.stringify(shown, null, 2));
    } catch (error) {
      if (error instanceof OperationError) return text(refusal(error), true);
      // The runner logged the details under this request ID.
      return text(`"${operation.name}" failed unexpectedly. The server log has the details (request ${actor.requestId}).`, true);
    }
  }
}
