import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { OperationAuditLog } from './operation-audit.js';
import { OperationCatalog } from './operation-catalog.service.js';
import { DEFAULT_OPERATIONS_CONFIG, OPERATIONS_CONFIG, OperationRunner } from './operation-runner.service.js';

/**
 * The shared operation layer: one operation per admin action, run the same way by the admin REST
 * API and the MCP server. Domain modules contribute @Operations() providers.
 */
@Module({
  imports: [DiscoveryModule],
  providers: [{ provide: OPERATIONS_CONFIG, useValue: DEFAULT_OPERATIONS_CONFIG }, OperationAuditLog, OperationRunner, OperationCatalog],
  exports: [OperationRunner, OperationCatalog],
})
export class OperationsModule {}
