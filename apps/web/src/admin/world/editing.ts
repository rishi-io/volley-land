import { type LayoutItemKind, type LayoutItemRef, normalizeDegrees, snapTo } from '@volleyland/game-core';

/*
 * Selection for the world builder. The editing operations themselves are shared with the server
 * (game-core world-editing.ts), so the builder and MCP clients edit worlds the same way.
 */

export {
  deleteItems,
  duplicateItems,
  itemsIn,
  mirrorItems,
  moveItems,
  positionOf,
  reorderRegion,
  rotateItems,
  updateItem,
} from '@volleyland/game-core';
export { normalizeDegrees, snapTo as round };

export type ItemKind = LayoutItemKind;
export type ItemRef = LayoutItemRef;

/** Selected items, as a set of "kind:index" keys. */
export type Selection = ReadonlySet<string>;
export const keyOf = (ref: ItemRef) => `${ref.kind}:${ref.index}`;
export const refOf = (key: string): ItemRef => {
  const [kind, index] = key.split(':');
  return { kind: kind as ItemKind, index: Number(index) };
};
export const refsOf = (selection: Selection): ItemRef[] => [...selection].map(refOf);
export const select = (...refs: ItemRef[]): Selection => new Set(refs.map(keyOf));
export const EMPTY: Selection = new Set();
