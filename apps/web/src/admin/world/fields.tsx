'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '../admin.module.css';

/** A number input that keeps what is typed and reports only finite numbers. */
export function NumberField({
  label,
  unit,
  step,
  value,
  onChange,
  help,
}: {
  label: string;
  unit: string;
  step: number;
  value: number;
  onChange: (value: number) => void;
  help?: string;
}) {
  const [text, setText] = useState(String(value));
  const reported = useRef(value);
  useEffect(() => {
    // Follow changes made elsewhere (dragging on the plan), not the ones this input reported.
    if (value === reported.current) return;
    reported.current = value;
    setText(String(value));
  }, [value]);
  return (
    <label className={styles.stackField}>
      <span>{label}</span>
      <span className={styles.numberInput}>
        <input
          className={styles.input}
          type="number"
          inputMode="decimal"
          step={step}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() === '' || !Number.isFinite(n)) return;
            reported.current = n;
            onChange(n);
          }}
        />
        <span className={styles.unit}>{unit}</span>
      </span>
      {help && <small>{help}</small>}
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className={styles.stackField}>
      <span>{label}</span>
      <select className={styles.input} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SliderField({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className={styles.stackField}>
      <span>
        {label} <output className={styles.sliderValue}>{format(value)}</output>
      </span>
      <input className={styles.slider} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
