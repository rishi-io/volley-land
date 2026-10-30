import { Module } from '@nestjs/common';
import { ContentWorkflowModule } from '../content-workflow/content-workflow.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';
import { DEFAULT_SEED, SETTINGS_SEED } from './defaults.js';
import { JsonFileSettingsStore } from './json-file-settings-store.js';
import { SETTINGS_STORE } from './settings-store.js';
import { SettingsOperations } from './settings.operations.js';
import { SettingsService } from './settings.service.js';

@Module({
  imports: [OperationsModule, ContentWorkflowModule],
  controllers: [AdminController],
  providers: [
    // Phase 0: a JSON file. Swap for a database-backed SettingsStore when settings move to Postgres.
    { provide: SETTINGS_STORE, useFactory: () => new JsonFileSettingsStore(process.env.SETTINGS_FILE ?? 'data/settings.json') },
    { provide: SETTINGS_SEED, useValue: DEFAULT_SEED },
    SettingsService,
    SettingsOperations,
    AdminGuard,
  ],
  exports: [SettingsService],
})
export class SettingsModule {}
