import { ServerResponse } from 'node:http';
import { Controller, Delete, Get, Inject, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpRequest } from './mcp-access.guard.js';
import { McpAccessGuard } from './mcp-access.guard.js';
import { McpAuditLog } from './mcp-audit.js';
import { McpToolCatalog } from './mcp-tool-catalog.service.js';

const jsonRpcError = (res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
};

const messagesOf = (body: unknown): { method?: unknown; params?: unknown }[] =>
  (Array.isArray(body) ? body : [body]).filter((m): m is { method?: unknown; params?: unknown } => typeof m === 'object' && m !== null);

/**
 * MCP over Streamable HTTP at /api/mcp (behind Caddy, /api/* reaches the server). Stateless: no
 * MCP session, a fresh McpServer and transport per POST, JSON responses rather than SSE. Any
 * instance can serve any request, and there is nothing to clean up when a client goes away.
 *
 * Refusals (disabled, host, origin, rate limit) happen in McpAccessGuard as normal HTTP errors.
 * Past the guard this controller owns the raw response, so it writes JSON-RPC errors itself.
 */
@Controller('api/mcp')
@UseGuards(McpAccessGuard)
export class McpServerController {
  private readonly logger = new Logger(McpServerController.name);

  constructor(
    @Inject(McpToolCatalog) private readonly catalog: McpToolCatalog,
    @Inject(McpAuditLog) private readonly audit: McpAuditLog,
  ) {}

  @Post()
  async handle(@Req() req: McpRequest, @Res() res: ServerResponse): Promise<void> {
    const actor = req.mcpActor;
    if (!actor) throw new Error('McpAccessGuard did not attach an actor');
    for (const message of messagesOf(req.body)) {
      if (message.method === 'initialize') {
        const params = (message.params ?? {}) as { clientInfo?: unknown; protocolVersion?: unknown };
        this.audit.clientConnected(actor, params.clientInfo, params.protocolVersion);
      }
    }

    const server = this.catalog.buildServer(actor);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    transport.onerror = (error) => this.audit.requestRejected(actor, error.message); // before connect(), which wraps it
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      // Nest's JSON body parser already consumed the stream: hand the transport the parsed body.
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      this.logger.error(`MCP request ${actor.requestId} failed`, error instanceof Error ? error.stack : String(error));
      if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal server error');
      else res.end();
    }
  }

  /** No standalone SSE stream and no sessions to end, which the spec allows a server to refuse with 405. */
  @Get()
  stream(@Res() res: ServerResponse): void {
    jsonRpcError(res, 405, -32000, 'Method not allowed: this MCP server is stateless and answers POST only', { allow: 'POST' });
  }

  @Delete()
  endSession(@Res() res: ServerResponse): void {
    jsonRpcError(res, 405, -32000, 'Method not allowed: this MCP server has no sessions', { allow: 'POST' });
  }
}
