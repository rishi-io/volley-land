import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module.js';
import { AdminGuard } from '../settings/admin.guard.js';
import { ContentAdminController } from './content-admin.controller.js';
import { CONTENT_STORE } from './content-store.js';
import { ContentOperations } from './content.operations.js';
import { ContentService, QUESTION_POOL_CHECK } from './content.service.js';
import { JsonFileContentStore } from './json-file-content-store.js';
import { CONTENT_SEED, DEFAULT_CONTENT_SEED } from './seed.js';

/** The question bank CMS: curriculum taxonomy, sources and questions, managed by admins over REST and MCP. */
@Module({
  imports: [OperationsModule],
  controllers: [ContentAdminController],
  providers: [
    // Phase 0: a JSON file next to the settings file. Swap for a Postgres-backed ContentStore in Phase 1.
    { provide: CONTENT_STORE, useFactory: () => new JsonFileContentStore(process.env.QUESTIONS_FILE ?? 'data/questions.json') },
    { provide: CONTENT_SEED, useValue: DEFAULT_CONTENT_SEED },
    ContentService,
    { provide: QUESTION_POOL_CHECK, useExisting: ContentService },
    ContentOperations,
    AdminGuard,
  ],
  exports: [ContentService, QUESTION_POOL_CHECK],
})
export class ContentWorkflowModule {}
