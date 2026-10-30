'use client';

import { useEffect, useRef, useState } from 'react';
import { useRuntime } from '../runtime';
import { useHud } from './hud-store';

/** The MCQ shown to a hit player. Keyboard: 1–6 picks an option; Tab/Enter also work. */
export function QuestionOverlay() {
  const runtime = useRuntime();
  const question = useHud((s) => s.question);
  const answered = useHud((s) => s.answeredOptionId);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const firstButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!question) return;
    firstButton.current?.focus();
    const tick = () => {
      const serverNow = runtime.connection?.clock.now(Date.now()) ?? question.serverTime;
      setSecondsLeft(Math.max(0, Math.ceil((question.deadline - serverNow) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [question, runtime]);

  useEffect(() => {
    if (!question) return;
    const onKey = (event: KeyboardEvent) => {
      const index = Number(event.key) - 1;
      const option = question.options[index];
      if (Number.isInteger(index) && option) {
        event.preventDefault();
        submit(option.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!question) return null;

  function submit(optionId: string) {
    if (!question || useHud.getState().answeredOptionId) return;
    useHud.getState().set({ answeredOptionId: optionId });
    void runtime.connection?.answer(question.encounterId, optionId);
  }

  return (
    <section className="question" role="dialog" aria-modal="false" aria-labelledby="question-prompt">
      <header className="question__header">
        <span>Answer to unfreeze</span>
        <span aria-live="polite">{secondsLeft}s left</span>
      </header>
      <h2 id="question-prompt" className="question__prompt">
        {question.prompt}
      </h2>
      <div className="question__options">
        {question.options.map((option, i) => (
          <button
            key={option.id}
            ref={i === 0 ? firstButton : undefined}
            type="button"
            className="question__option"
            disabled={answered !== null}
            aria-pressed={answered === option.id}
            onClick={() => submit(option.id)}
          >
            <kbd>{i + 1}</kbd> {option.text}
          </button>
        ))}
      </div>
      {answered && <p className="question__waiting">Answer sent — the server is checking it…</p>}
    </section>
  );
}
