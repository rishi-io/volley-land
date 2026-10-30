import { Module } from '@nestjs/common';
import { QuestionSelectionModule } from '../question-selection/question-selection.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { RoomRegistry } from './room-registry.service.js';
import { RoomOperations } from './rooms.operations.js';

@Module({
  imports: [QuestionSelectionModule, SettingsModule],
  providers: [RoomRegistry, RoomOperations],
  exports: [RoomRegistry],
})
export class MatchSimulationModule {}
