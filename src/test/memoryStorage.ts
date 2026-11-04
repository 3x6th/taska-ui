/**
 * A `Storage` of its own, for tests that stand in two tabs: each tab gets its
 * own `sessionStorage` and the two share one `localStorage`, as a browser's do.
 * jsdom's `window.localStorage` is one per test file, which cannot do that.
 */
export class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.has(key) ? (this.items.get(key) as string) : null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }

  /** A copy, as "Duplicate tab" copies `sessionStorage`. */
  copy(): MemoryStorage {
    const copy = new MemoryStorage();
    for (const [key, value] of this.items) copy.setItem(key, value);
    return copy;
  }

  keys(): string[] {
    return [...this.items.keys()].sort();
  }
}
