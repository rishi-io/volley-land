import { Injectable, Logger } from '@nestjs/common';
import { whoIs } from '../operations/operation-audit.js';
import type { Actor } from '../operations/operation.js';

/**
 * MCP connection events. Tool calls are audited by OperationRunner like every other operation
 * call (op.call ... via=mcp); this adds what only MCP has.
 */
@Injectable()
export class McpAuditLog {
  private readonly logger = new Logger('McpAudit');

  /** From the initialize request: which MCP client connected, and with which protocol version. */
  clientConnected(actor: Actor, clientInfo: unknown, protocolVersion: unknown): void {
    const info = (clientInfo ?? {}) as { name?: unknown; version?: unknown };
    this.logger.log(`mcp.client_connected client=${String(info.name ?? '?')}@${String(info.version ?? '?')} protocol=${String(protocolVersion ?? '?')} ${whoIs(actor)}`);
  }

  /** The SDK refused the request (bad JSON-RPC, wrong headers, unsupported protocol version). */
  requestRejected(actor: Actor, reason: string): void {
    this.logger.warn(`mcp.request_rejected reason=${JSON.stringify(reason)} ${whoIs(actor)}`);
  }
}
