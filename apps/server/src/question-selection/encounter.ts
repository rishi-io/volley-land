import type { EncounterOutcome, QuestionOption } from '@volleyland/contracts';
import type { SelectedQuestion } from './question-selector.js';

export interface Encounter {
  id: string;
  targetId: string;
  shooterId: string;
  question: SelectedQuestion;
  presentedAt: number;
  /** Server-clock deadline; client clocks are never consulted. */
  deadline: number;
  outcome: EncounterOutcome | null;
  selectedOptionId: string | null;
}

export function openEncounter(params: {
  id: string;
  targetId: string;
  shooterId: string;
  question: SelectedQuestion;
  now: number;
  answerTimeMs: number;
}): Encounter {
  return {
    id: params.id,
    targetId: params.targetId,
    shooterId: params.shooterId,
    question: params.question,
    presentedAt: params.now,
    deadline: params.now + params.answerTimeMs,
    outcome: null,
    selectedOptionId: null,
  };
}

export type AnswerEvaluation =
  | { accepted: true; outcome: EncounterOutcome }
  | { accepted: false; reason: 'already_resolved' | 'unknown_option' };

/**
 * Evaluate the single answer for an encounter. Exactly one answer is ever accepted: the first
 * valid one resolves the encounter, and an answer at or after the deadline resolves it as a timeout.
 */
export function evaluateAnswer(encounter: Encounter, optionId: string, now: number): AnswerEvaluation {
  if (encounter.outcome !== null) return { accepted: false, reason: 'already_resolved' };
  if (!encounter.question.options.some((o) => o.id === optionId)) return { accepted: false, reason: 'unknown_option' };
  const outcome: EncounterOutcome =
    now >= encounter.deadline ? 'timeout' : optionId === encounter.question.correctOptionId ? 'correct' : 'incorrect';
  encounter.outcome = outcome;
  encounter.selectedOptionId = outcome === 'timeout' ? null : optionId;
  return { accepted: true, outcome };
}

/** Resolve as a timeout if the deadline has passed. Returns true when this call resolved it. */
export function expireEncounter(encounter: Encounter, now: number): boolean {
  if (encounter.outcome !== null || now < encounter.deadline) return false;
  encounter.outcome = 'timeout';
  return true;
}

/** The public view of an encounter's question: prompt and options only, no answer key. */
export function publicOptions(encounter: Encounter): QuestionOption[] {
  return encounter.question.options.map((o) => ({ id: o.id, text: o.text }));
}
