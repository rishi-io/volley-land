import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, UseFilters, UseGuards } from '@nestjs/common';
import { type AdminSettingsResponse, SettingsSection, type Versioned } from '@volleyland/contracts';
import type { World } from '@volleyland/game-core';
import { OperationErrorFilter } from '../operations/operation-error.filter.js';
import { OperationRunner } from '../operations/operation-runner.service.js';
import { type Actor, OperationError } from '../operations/operation.js';
import { AdminActor } from './admin-actor.js';
import { AdminGuard } from './admin.guard.js';
import { SettingsOperations } from './settings.operations.js';

/** A field of a JSON body that may not be an object; validation is the operation's job. */
const field = (body: unknown, key: string): unknown => (typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined);

/**
 * Admin HTTP API (ADMIN_API_PREFIX). Behind Caddy, /api/* routes here. Each route only maps the
 * request onto a settings operation and runs it; the MCP server runs the same operations.
 * Refusals become AdminError responses (OperationErrorFilter).
 */
@Controller('api/admin')
@UseGuards(AdminGuard)
@UseFilters(OperationErrorFilter)
export class AdminController {
  constructor(
    @Inject(OperationRunner) private readonly runner: OperationRunner,
    @Inject(SettingsOperations) private readonly ops: SettingsOperations,
  ) {}

  @Get('settings')
  async getSettings(@AdminActor() actor: Actor): Promise<AdminSettingsResponse> {
    const settings = await this.runner.run(this.ops.getSettings, {}, actor);
    const worlds = (await this.runner.run(this.ops.listWorlds, { detail: 'full' }, actor)) as Versioned<World>[];
    return { ...settings, worlds };
  }

  @Put('settings/:section')
  async updateSection(@Param('section') section: string, @Body() body: unknown, @AdminActor() actor: Actor): Promise<Versioned<unknown>> {
    const name = SettingsSection.safeParse(section);
    if (!name.success) throw new OperationError('invalid', `No settings section "${section}"`, [{ path: 'section', message: `one of ${SettingsSection.options.join(', ')}` }]);
    return this.runner.run(this.ops.updateSection(name.data), { expectedVersion: field(body, 'expectedVersion'), changes: field(body, 'value') }, actor);
  }

  @Post('worlds')
  async createWorld(@Body() body: unknown, @AdminActor() actor: Actor): Promise<Versioned<World>> {
    const world = field(body, 'world');
    const input = { id: field(world, 'id'), name: field(world, 'name'), description: field(world, 'description'), start: { from: 'layout', layout: field(world, 'layout') } };
    return (await this.runner.run(this.ops.createWorld, input, actor)) as Versioned<World>;
  }

  @Put('worlds/:id')
  async updateWorld(@Param('id') id: string, @Body() body: unknown, @AdminActor() actor: Actor): Promise<Versioned<World>> {
    const world = field(body, 'world');
    if (field(world, 'id') !== id) {
      throw new OperationError('invalid', 'A world ID cannot change: save it as a new world instead', [{ path: 'id', message: `must be "${id}"` }]);
    }
    const input = { id, expectedVersion: field(body, 'expectedVersion'), name: field(world, 'name'), description: field(world, 'description'), layout: field(world, 'layout') };
    return this.runner.run(this.ops.updateWorld, input, actor);
  }

  @Delete('worlds/:id')
  @HttpCode(204)
  async deleteWorld(@Param('id') id: string, @Query('expectedVersion') expectedVersion: string, @AdminActor() actor: Actor): Promise<void> {
    await this.runner.run(this.ops.deleteWorld, { id, expectedVersion: Number(expectedVersion) }, actor);
  }
}
