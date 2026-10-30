import { Inject, Injectable } from '@nestjs/common';
import { createRng, hashSeed } from '@volleyland/game-core';
import { ContentService, type QuestionPool } from '../content-workflow/content.service.js';
import type { QuestionHistory } from './question-history.js';
import { QuestionSelector } from './question-selector.js';

@Injectable()
export class QuestionSelectionService {
  constructor(@Inject(ContentService) private readonly content: ContentService) {}

  /**
   * A selector seeded by the match ID, so a match's question sequence is reproducible for the same
   * bank and history. It reads the match's pool of published questions at every hit, so a question
   * published, edited or retired in the CMS is asked (or not) from the next hit on. The history is
   * the room's, so players are not asked again what an earlier match in the room asked them.
   */
  forMatch(matchId: string, pool: QuestionPool, history: QuestionHistory): QuestionSelector {
    return new QuestionSelector(() => this.content.pool(pool), createRng(hashSeed(`questions:${matchId}`)), history);
  }
}
