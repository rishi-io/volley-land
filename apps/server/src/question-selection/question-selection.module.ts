import { Module } from '@nestjs/common';
import { ContentWorkflowModule } from '../content-workflow/content-workflow.module.js';
import { QuestionSelectionService } from './question-selection.service.js';

@Module({
  imports: [ContentWorkflowModule],
  providers: [QuestionSelectionService],
  exports: [QuestionSelectionService],
})
export class QuestionSelectionModule {}
