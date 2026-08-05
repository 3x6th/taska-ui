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
