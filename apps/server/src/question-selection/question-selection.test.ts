import { createRng } from '@volleyland/game-core';
import { describe, expect, it } from 'vitest';
import { evaluateAnswer, expireEncounter, openEncounter, publicOptions } from './encounter.js';
import { seedQuestions } from '../content-workflow/seed.js';
import { QuestionHistory } from './question-history.js';
import { QuestionSelector } from './question-selector.js';

const bank = seedQuestions();

describe('fixture question bank', () => {
  it('loads and validates every question', () => {
    expect(bank.length).toBeGreaterThanOrEqual(10);
  });
});

describe('QuestionSelector', () => {
  it('is reproducible for the same seed', () => {
    const a = new QuestionSelector(bank, createRng(1));
    const b = new QuestionSelector(bank, createRng(1));
    const pick = (s: QuestionSelector) => Array.from({ length: 6 }, () => s.select('p1'));
    expect(pick(a)).toEqual(pick(b));
  });

  it('does not repeat a question for a player until the bank is exhausted', () => {
    const selector = new QuestionSelector(bank, createRng(9));
    const ids = Array.from({ length: bank.length }, () => selector.select('p1').questionId);
    expect(new Set(ids).size).toBe(bank.length);
    // After exhaustion it starts over rather than failing.
    expect(bank.map((q) => q.id)).toContain(selector.select('p1').questionId);
  });

  it('shares a history across selectors, so a new match does not ask a player again', () => {
    const history = new QuestionHistory();
    const first = new QuestionSelector(bank, createRng(1), history);
    const asked = new Set(Array.from({ length: 10 }, () => first.select('p1').questionId));
    const second = new QuestionSelector(bank, createRng(1), history);
    const next = Array.from({ length: bank.length - 10 }, () => second.select('p1').questionId);
    expect(next.filter((id) => asked.has(id))).toEqual([]);
    expect(history.askedCount('p1')).toBe(bank.length);
  });

  it('shuffles options but keeps the same set and answer key', () => {
    const selector = new QuestionSelector(bank, createRng(3));
    const selected = selector.select('p1');
    const source = bank.find((q) => q.id === selected.questionId)!;
    expect([...selected.options].sort((x, y) => x.id.localeCompare(y.id))).toEqual(
      [...source.options].sort((x, y) => x.id.localeCompare(y.id)),
    );
    expect(selected.correctOptionId).toBe(source.correctOptionId);
  });
});

describe('QuestionHistory', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

  it('asks every question once before any repeat, then repeats only from the older half', () => {
    const history = new QuestionHistory();
    const rng = createRng(4);
    const order = Array.from({ length: pool.length }, () => history.choose('p1', pool, rng).id);
    expect(new Set(order).size).toBe(pool.length);
    for (let i = 0; i < 50; i++) {
      const recent = order.slice(-2); // with 5 questions, the 2 most recent are never eligible
      const id = history.choose('p1', pool, rng).id;
      expect(recent, `repeat ${i}`).not.toContain(id);
      order.push(id);
    }
  });

  it('never asks the same question twice in a row, even from a pool of two', () => {
    const history = new QuestionHistory();
    const rng = createRng(2);
    const two = pool.slice(0, 2);
    const order = Array.from({ length: 10 }, () => history.choose('p1', two, rng).id);
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
  });

  it('keeps each player separate, and forgets a player who leaves', () => {
    const history = new QuestionHistory();
    const rng = createRng(3);
    for (let i = 0; i < 3; i++) history.choose('p1', pool, rng);
    expect(history.askedCount('p1')).toBe(3);
    expect(history.askedCount('p2')).toBe(0);
    history.forget('p1');
    expect(history.askedCount('p1')).toBe(0);
  });
});

describe('encounter evaluation', () => {
  const question = new QuestionSelector(bank, createRng(5)).select('p2');
  const wrong = question.options.find((o) => o.id !== question.correctOptionId)!.id;
  const open = () =>
    openEncounter({ id: 'e1', targetId: 'p2', shooterId: 'p1', question, now: 1_000, answerTimeMs: 10_000 });

  it('measures the deadline on the server clock', () => {
    expect(open().deadline).toBe(11_000);
  });

  it('accepts exactly one answer', () => {
    const encounter = open();
    expect(evaluateAnswer(encounter, question.correctOptionId, 2_000)).toEqual({ accepted: true, outcome: 'correct' });
    expect(evaluateAnswer(encounter, wrong, 2_100)).toEqual({ accepted: false, reason: 'already_resolved' });
    expect(encounter.outcome).toBe('correct');
  });

  it('scores a wrong option as incorrect and an unknown option as not accepted', () => {
    expect(evaluateAnswer(open(), wrong, 2_000)).toEqual({ accepted: true, outcome: 'incorrect' });
    expect(evaluateAnswer(open(), 'zz', 2_000)).toEqual({ accepted: false, reason: 'unknown_option' });
  });

  it('treats an answer at or after the deadline as a timeout', () => {
    const encounter = open();
    expect(evaluateAnswer(encounter, question.correctOptionId, 11_000)).toEqual({ accepted: true, outcome: 'timeout' });
    expect(encounter.selectedOptionId).toBeNull();
  });

  it('expires unanswered encounters only once the deadline passes', () => {
    const encounter = open();
    expect(expireEncounter(encounter, 10_999)).toBe(false);
    expect(expireEncounter(encounter, 11_000)).toBe(true);
    expect(expireEncounter(encounter, 12_000)).toBe(false);
  });

  it('public options never include the answer key', () => {
    const json = JSON.stringify(publicOptions(open()));
    expect(json).not.toContain('correct');
    expect(json).not.toContain(question.explanation);
  });
});
