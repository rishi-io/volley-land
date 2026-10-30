import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, UseFilters, UseGuards } from '@nestjs/common';
import { ContentKind } from '@volleyland/contracts';
import { OperationErrorFilter } from '../operations/operation-error.filter.js';
import { OperationRunner } from '../operations/operation-runner.service.js';
import { type Actor, type AnyOperation, OperationError } from '../operations/operation.js';
import { AdminActor } from '../settings/admin-actor.js';
import { AdminGuard } from '../settings/admin.guard.js';
import { ContentOperations } from './content.operations.js';

/** A field of a JSON body that may not be an object; validation is the operation's job. */
const field = (body: unknown, key: string): unknown => (typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined);

/**
 * Question bank CMS routes of the admin HTTP API, for the panel. Each route only maps the request
 * onto a content operation and runs it; MCP clients run the same operations. Admin REST callers
 * have write access, so they are shown answer keys (as authors).
 */
@Controller('api/admin')
@UseGuards(AdminGuard)
@UseFilters(OperationErrorFilter)
export class ContentAdminController {
  constructor(
    @Inject(OperationRunner) private readonly runner: OperationRunner,
    @Inject(ContentOperations) private readonly ops: ContentOperations,
  ) {}

  /** The taxonomy and sources, for the panel's pages and pickers. Questions are listed by the route below. */
  @Get('content')
  async getContent(@AdminActor() actor: Actor): Promise<Record<string, unknown>> {
    const kinds = ['countries', 'curricula', 'levels', 'subjects', 'topics', 'sources'] as const;
    const lists = await Promise.all(kinds.map((kind) => this.runner.run(this.ops.taxonomy(kind).list, {}, actor)));
    return Object.fromEntries(kinds.map((kind, i) => [kind, lists[i]]));
  }

  /** Questions matching the query's filters (list_questions); numbers arrive as text. */
  @Get('content/questions')
  async listQuestions(@Query() query: Record<string, string>, @AdminActor() actor: Actor): Promise<unknown> {
    const input: Record<string, unknown> = { ...query };
    for (const key of ['offset', 'limit'] as const) if (query[key] !== undefined) input[key] = Number(query[key]);
    return this.runner.run(this.ops.listQuestions, input, actor);
  }

  @Post('content/questions/import')
  async importQuestions(@Body() body: unknown, @AdminActor() actor: Actor): Promise<unknown> {
    return this.runner.run(this.ops.importQuestions, { questions: field(body, 'questions'), dryRun: field(body, 'dryRun') }, actor);
  }

  @Post('content/:kind')
  async create(@Param('kind') kind: string, @Body() body: unknown, @AdminActor() actor: Actor): Promise<unknown> {
    return this.runner.run(this.opsFor(kind).create, field(body, 'record'), actor);
  }

  @Put('content/:kind/:id')
  async update(@Param('kind') kind: string, @Param('id') id: string, @Body() body: unknown, @AdminActor() actor: Actor): Promise<unknown> {
    return this.runner.run(this.opsFor(kind).update, { id, expectedVersion: field(body, 'expectedVersion'), changes: field(body, 'changes') }, actor);
  }

  @Delete('content/:kind/:id')
  @HttpCode(204)
  async remove(@Param('kind') kind: string, @Param('id') id: string, @Query('expectedVersion') expectedVersion: string, @AdminActor() actor: Actor): Promise<void> {
    await this.runner.run(this.opsFor(kind).remove, { id, expectedVersion: Number(expectedVersion) }, actor);
  }

  private opsFor(kind: string): { create: AnyOperation; update: AnyOperation; remove: AnyOperation } {
    const parsed = ContentKind.safeParse(kind);
    if (!parsed.success) throw new OperationError('not_found', `No kind of content "${kind}"`, [{ path: 'kind', message: `one of ${ContentKind.options.join(', ')}` }]);
    if (parsed.data === 'questions') return { create: this.ops.createQuestion, update: this.ops.updateQuestion, remove: this.ops.deleteQuestion };
    return this.ops.taxonomy(parsed.data);
  }
}
