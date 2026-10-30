import { type Rng, shuffle } from '@volleyland/game-core';
import type { AuthoredQuestion } from '../content-workflow/authored-question.js';
import { QuestionHistory } from './question-history.js';

/** What a selector draws from: the questions themselves, or the live pool, read at every pick. */
export type QuestionSource = readonly AuthoredQuestion[] | (() => readonly AuthoredQuestion[]);

export interface SelectedQuestion {
  questionId: string;
  prompt: string;
  /** Options in the order this player will see them. */
  options: { id: string; text: string }[];
  correctOptionId: string;
  explanation: string;
}

/**
 * Per-match question selection: picks each player's question through the room's QuestionHistory
 * (no repeats for a player until the pool is exhausted, across the room's matches) and shuffles
 * option order, all from the match's seeded RNG.
 */
export class QuestionSelector {
  private readonly bank: () => readonly AuthoredQuestion[];

  constructor(
    source: QuestionSource,
    private readonly rng: Rng,
    /** Shared by the room's matches; a selector on its own (tests) keeps its own. */
    private readonly history: QuestionHistory = new QuestionHistory(),
  ) {
    this.bank = typeof source === 'function' ? source : () => source;
  }

  select(playerId: string): SelectedQuestion {
    const bank = this.bank();
    if (bank.length === 0) throw new Error('Question bank is empty');
    const question = this.history.choose(playerId, bank, this.rng);
    return {
      questionId: question.id,
      prompt: question.prompt,
      options: shuffle(question.options, this.rng),
      correctOptionId: question.correctOptionId,
      explanation: question.explanation,
    };
  }
}
