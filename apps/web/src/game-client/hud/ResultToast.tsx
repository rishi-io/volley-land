'use client';

import { useEffect } from 'react';
import { useHud } from './hud-store';

const LABEL = { correct: 'Correct — shield up!', incorrect: 'Incorrect — 25 damage', timeout: 'Time up — 25 damage' } as const;

/** Shown after the server resolves an encounter, including the correct answer and why. */
export function ResultToast() {
  const result = useHud((s) => s.lastResult);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => useHud.getState().set({ lastResult: null }), 5000);
    return () => clearTimeout(timer);
  }, [result]);

  if (!result) return null;
  const correct = result.options.find((o) => o.id === result.correctOptionId);
  return (
    <div className={`toast toast--${result.outcome}`} role="status" aria-live="assertive">
      <strong>
        {result.outcome === 'correct' ? '✔ ' : '✖ '}
        {LABEL[result.outcome]}
      </strong>
      {result.outcome !== 'correct' && correct && <p>Answer: {correct.text}</p>}
      {result.explanation && <p className="toast__explanation">{result.explanation}</p>}
    </div>
  );
}
