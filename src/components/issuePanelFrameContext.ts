import { createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** What the state inside the frame says about the dialog and its head. */
export interface IssuePanelHeadState {
  /** "{KEY} issue", or "Issue" before the key is known. */
  label: string;
  /** The issue is still on its way: `aria-busy` on the dialog. */
  busy: boolean;
  /** The delete question is open between head and body, so the head's own line gives way (§4.10). */
  asking: boolean;
}

interface IssuePanelFrameSlots {
  /** The head's left part — the type chip, the key and the type, or what stands for them. */
  start: HTMLElement | null;
  /** Between the spacer and Close — Share and Delete, once the issue has loaded. */
  actions: HTMLElement | null;
  setHead: (head: IssuePanelHeadState) => void;
}

export const IssuePanelFrameContext = createContext<IssuePanelFrameSlots | null>(null);

/**
 * How a state inside `IssuePanelFrame` fills the frame's head and names the
 * dialog (TAS-380, art-director's ruling 7).
 *
 * The frame owns the head and its Close, so that Close is one DOM node from
 * the first frame of loading to the loaded issue and through a render failure;
 * what each state puts beside it is rendered by that state and portalled into
 * the head's two slots. A portal keeps React's tree — a failure while drawing
 * the head is caught by the panel's error boundary like any other — while the
 * DOM stays the head's own row of 52.
 *
 * The label, `aria-busy` and the head's line are three plain values, set from a
 * layout effect so the dialog never paints with the previous state's name.
 */
export function useIssuePanelHead({ label, busy = false, asking = false }: Partial<IssuePanelHeadState> & { label: string }) {
  const frame = useContext(IssuePanelFrameContext);
  const setHead = frame?.setHead;
  useLayoutEffect(() => {
    setHead?.({ label, busy, asking });
  }, [setHead, label, busy, asking]);
  return {
    start: (node: ReactNode) => (frame?.start ? createPortal(node, frame.start) : null),
    actions: (node: ReactNode) => (frame?.actions ? createPortal(node, frame.actions) : null),
  };
}
