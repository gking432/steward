import type { Workspace } from './types';
import type { StewardState } from '../steward-types';
import { toModel } from './convert';

/** One-way import boundary. Current state is never converted during editing. */
export function migrateWorkspace(value: Workspace | StewardState): Workspace {
  const result = 'modelVersion' in value ? structuredClone(value) : toModel(value);
  return { ...result, revision: result.revision ?? 0 };
}

/** Serialized, coalescing writes. Older responses cannot acknowledge new work. */
export class SaveQueue<T> {
  private pending: T | undefined;
  private running = false;
  constructor(private write: (value: T) => Promise<void>, private status: (state: 'saving' | 'saved' | 'offline' | 'conflict') => void) {}
  enqueue(value: T) { this.pending = value; void this.flush(); }
  async flush() {
    if (this.running || this.pending === undefined) return;
    this.running = true;
    this.status('saving');
    try {
      while (this.pending !== undefined) {
        const value = this.pending;
        this.pending = undefined;
        try { await this.write(value); }
        catch (error) {
          if (this.pending === undefined) this.pending = value;
          this.status(error instanceof Error && error.message === 'conflict' ? 'conflict' : 'offline');
          return;
        }
      }
      this.status('saved');
    } finally { this.running = false; }
  }
}
