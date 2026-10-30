import { describe, expect, it } from 'vitest';
import { describeNotice, mergeNotice } from './settings-notice';

describe('settings notice', () => {
  it('describes changes with the admin panel labels and units, hiding bot values', () => {
    const notice = mergeNotice(null, true, [
      { section: 'movement', key: 'playerSpeed', from: 6, to: 8 },
      { section: 'appearance', key: 'nameTags', from: true, to: false },
      { section: 'appearance', key: 'healthBars', from: 'opponents', to: 'everyone' },
      { section: 'rooms', key: 'worldId', from: 'Prototype', to: 'Yard' },
      { section: 'world', key: 'layout', from: null, to: null },
      { section: 'bots', key: 'aimErrorDeg', from: null, to: null },
      { section: 'bots', key: 'reactionMs', from: null, to: null },
    ])!;
    expect(describeNotice(notice)).toEqual([
      { title: 'Movement', lines: [{ label: 'Running speed', value: '6 m/s → 8 m/s' }] },
      {
        title: 'Characters',
        lines: [
          { label: 'Name tags', value: 'on → off' },
          { label: 'Health bars', value: 'Other players → Everyone' },
        ],
      },
      { title: 'Rooms', lines: [{ label: 'World', value: 'Prototype → Yard' }] },
      { title: 'World', lines: [{ label: 'Layout', value: 'rebuilt' }] },
      { title: 'Bots', lines: [{ label: 'Behaviour', value: 'updated' }] },
    ]);
  });

  it('folds quick successive saves into one notice', () => {
    const first = mergeNotice(null, true, [{ section: 'movement', key: 'playerSpeed', from: 6, to: 7 }]);
    const second = mergeNotice(first, false, [
      { section: 'movement', key: 'playerSpeed', from: 7, to: 8 },
      { section: 'appearance', key: 'nameTags', from: true, to: false },
    ]);
    expect(second).toEqual({
      newMatch: true,
      changes: [
        { section: 'movement', key: 'playerSpeed', from: 6, to: 8 },
        { section: 'appearance', key: 'nameTags', from: true, to: false },
      ],
    });
  });

  it('drops a setting that was changed back, and the notice when nothing is left', () => {
    const shown = mergeNotice(null, false, [{ section: 'appearance', key: 'nameTags', from: true, to: false }]);
    expect(mergeNotice(shown, false, [{ section: 'appearance', key: 'nameTags', from: false, to: true }])).toBeNull();
    // A new match is still news even if its setting was changed back.
    const restarted = mergeNotice(null, true, [{ section: 'movement', key: 'playerSpeed', from: 6, to: 8 }]);
    expect(mergeNotice(restarted, true, [{ section: 'movement', key: 'playerSpeed', from: 8, to: 6 }])).toEqual({ newMatch: true, changes: [] });
  });
});
