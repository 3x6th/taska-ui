import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** What stands in for `children` once one of them has thrown while rendering. */
  fallback: (error: Error, reset: () => void) => ReactNode;
  /**
   * A value whose change means "try the children again" — the route, the issue
   * a card draws. Compared with `Object.is`, so an object works when it is the
   * same object until its data changes (react-query keeps it so).
   */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** The `resetKey` the error was caught under, so a new one can clear it. */
  caughtUnder: unknown;
}

/**
 * Where a render that throws stops (TAS-173). Before this there was no error
 * boundary anywhere in `src`, so on React 19 one value a component could not
 * draw unmounted the whole tree — a blank page with nothing to read and no way
 * out but the address bar. Three levels use it, each drawing its own fallback:
 * the app outside its shell (`AppErrorBoundary`), the issue panel, and every
 * card and search row, so one issue that cannot be drawn costs one card.
 *
 * A class because React still has no hook for this. It catches errors thrown
 * while rendering and in lifecycle methods, not in event handlers or promises —
 * those already have their own paths to the screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, caughtUnder: undefined };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    if (state.error === null) return state.caughtUnder === props.resetKey ? null : { caughtUnder: props.resetKey };
    // The data or the address moved on since the throw: try the children again.
    if (!Object.is(state.caughtUnder, props.resetKey)) return { error: null, caughtUnder: props.resetKey };
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The one place the stack goes. The fallback shows the message only.
    console.error("A render failed and was caught by an error boundary.", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}
