import type { ParsedSnapshot, StateManagerInterface } from "./actions/types.js";

const DEFAULT_CACHE_TTL = 5000; // 5 seconds

export class StateManager implements StateManagerInterface {
  private snapshot: ParsedSnapshot | null = null;
  private cacheTTL: number;

  constructor(cacheTTL = DEFAULT_CACHE_TTL) {
    this.cacheTTL = cacheTTL;
  }

  getCachedSnapshot(): ParsedSnapshot | null {
    if (!this.snapshot) return null;
    if (Date.now() - this.snapshot.timestamp > this.cacheTTL) {
      this.snapshot = null;
      return null;
    }
    return this.snapshot;
  }

  setCachedSnapshot(snapshot: ParsedSnapshot): void {
    this.snapshot = snapshot;
  }

  invalidateCache(): void {
    this.snapshot = null;
  }

  getSnapshotCacheTTL(): number {
    return this.cacheTTL;
  }
}
