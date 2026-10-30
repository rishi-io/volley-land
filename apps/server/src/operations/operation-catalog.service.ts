import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { type AnyOperation, type OperationProvider, Operations } from './operation.js';

const NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/**
 * Every operation in the server, collected at startup from @Operations() providers in any module.
 * Names are API, so a bad or duplicate name fails startup rather than a call.
 */
@Injectable()
export class OperationCatalog implements OnModuleInit {
  private readonly logger = new Logger(OperationCatalog.name);
  private byName = new Map<string, AnyOperation>();

  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    const operations = this.discovery
      .getProviders({ metadataKey: Operations.KEY })
      .flatMap((wrapper) => (wrapper.instance as OperationProvider | undefined)?.operations() ?? []);
    this.byName = new Map();
    for (const operation of operations) {
      if (!NAME.test(operation.name)) throw new Error(`Operation name "${operation.name}" must be snake_case`);
      if (this.byName.has(operation.name)) throw new Error(`Operation "${operation.name}" is defined twice`);
      if (operation.destructive && operation.access !== 'write') throw new Error(`Operation "${operation.name}" is destructive but not a write`);
      this.byName.set(operation.name, operation);
    }
    if (operations.length > 0) this.logger.log(`Operations: ${[...this.byName.keys()].sort().join(', ')}`);
  }

  list(): AnyOperation[] {
    return [...this.byName.values()];
  }

  get(name: string): AnyOperation | null {
    return this.byName.get(name) ?? null;
  }
}
