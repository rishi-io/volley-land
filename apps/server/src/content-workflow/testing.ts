import type { ContentSet } from './authored-question.js';
import type { ContentStore } from './content-store.js';
import { ContentService } from './content.service.js';
import { InMemoryContentStore } from './in-memory-content-store.js';
import { DEFAULT_CONTENT_SEED } from './seed.js';

/** A loaded question bank in memory, for tests. */
export async function contentServiceWith(seed: ContentSet = DEFAULT_CONTENT_SEED, store: ContentStore = new InMemoryContentStore()): Promise<ContentService> {
  const service = new ContentService(store, seed);
  await service.load();
  return service;
}
