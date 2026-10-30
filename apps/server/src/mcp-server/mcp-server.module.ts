import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module.js';
import { McpAccessGuard } from './mcp-access.guard.js';
import { McpAuditLog } from './mcp-audit.js';
import { MCP_CONFIG, loadMcpConfig } from './mcp-config.js';
import { McpServerController } from './mcp-server.controller.js';
import { McpToolCatalog } from './mcp-tool-catalog.service.js';

/**
 * MCP server at /api/mcp. Its tools are the server's operations (OperationCatalog), the same
 * ones the admin REST API runs; this module only adds the transport, admission and MCP audit.
 */
@Module({
  imports: [OperationsModule],
  controllers: [McpServerController],
  providers: [{ provide: MCP_CONFIG, useFactory: () => loadMcpConfig() }, McpAccessGuard, McpAuditLog, McpToolCatalog],
})
export class McpServerModule {}
