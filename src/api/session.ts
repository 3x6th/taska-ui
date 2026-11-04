/**
 * The one channel through which an API implementation announces that the server
 * rejected the session and it could not be refreshed. `App` subscribes and sends
 * the user to the login form; nothing else in the UI has to guess from an error.
 *
 * It lives outside both implementations so `RestTaskaApi` and `MockTaskaApi`
 * share the listener plumbing instead of each growing their own copy.
 */
export class SessionExpiredSignal {
  private readonly listeners = new Set<() => void>();

  /** Returns the unsubscribe, so a `useEffect` can return it directly. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(): void {
    // Iterate a copy: a listener is allowed to unsubscribe itself while running.
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

/**
 * The companies build's second channel (TAS-500): the tab's company closed
 * mid-work — its membership was suspended or removed, the company is gone, or
 * its session could not be renewed — with the reason the shell words it by
 * (DESIGN.md §4.35). Kept apart from `SessionExpiredSignal` on purpose: a dead
 * company session is not a dead account session, and the reader is sent to
 * a different place for each (art-director, api-contract-guard §5).
 */
export class WorkspaceClosedSignal<Event> {
  private readonly listeners = new Set<(event: Event) => void>();

  /** Returns the unsubscribe, so a `useEffect` can return it directly. */
  subscribe(listener: (event: Event) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: Event): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}
