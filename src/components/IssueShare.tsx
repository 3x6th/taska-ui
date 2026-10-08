import { Check, Copy, Share2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type RefObject } from "react";
import { writeClipboard } from "../hooks/useCopied";
import { useDismissOnOutside, type DismissedBy } from "../hooks/useDismissOnOutside";
import { appUrl, issueKeyRoute, issueRoute } from "../lib/appLinks";

type LinkKind = "short" | "full";

const LINK_LABEL: Record<LinkKind, string> = { short: "Short link", full: "Full link" };

/** What the last press of a Copy button came to. `seq` tells two equal outcomes apart. */
interface CopyOutcome {
  link: LinkKind;
  result: "copied" | "failed";
  seq: number;
}

/**
 * "Share" in the issue panel's head (TAS-248): the two addresses of an issue,
 * each with its own Copy button.
 *
 * - **Short link** — `/browse/{issueKey}`, resolved by the server on the way in
 *   (`IssueKeyScreen`). The one to paste into a chat: it reads as the issue's
 *   name rather than as two uuids.
 * - **Full link** — `/projects/{projectId}/issues/{issueId}`, what the address
 *   bar shows once the panel is open. Opens without the key lookup.
 *
 * Both are built by `appUrl`, under the scheme this build routes by — hash
 * routing behind the base path on Pages, browser routing on the dev server.
 *
 * Read-only, so it is offered to every role that can see the issue, `VIEWER`
 * included. Its caller renders it only once the issue read has answered: until
 * then there is no key to share.
 *
 * The ways out are the bar's popovers' own hook — `Escape` and a press outside
 * (§4.12, §4.16). `Escape` puts focus back on the trigger; a press outside
 * leaves it where the press put it. Tabbing past the last control closes the
 * popover as well, so it never stays open over the panel body that focus has
 * moved into.
 */
export function IssueShare({ issueKey, projectId, issueId }: { issueKey: string; projectId: string; issueId: string }) {
  const [open, setOpen] = useState(false);
  // Around the trigger as well as the popover, as in every caller of the hook:
  // a press on the trigger of an open popover is inside, so the hook leaves it
  // to the trigger's own toggle.
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  const dismiss = useCallback((how: DismissedBy) => {
    setOpen(false);
    if (how === "escape") triggerRef.current?.focus();
  }, []);
  useDismissOnOutside(open, wrapRef, dismiss);

  // Only a move to a known element outside closes it. `relatedTarget` is null
  // when focus goes nowhere in particular — a click on a button in Safari, which
  // does not focus it, or the window losing focus — and closing then would shut
  // the popover under the reader's own press.
  const closeOnFocusOut = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (open && next && !wrapRef.current?.contains(next)) setOpen(false);
  };

  return (
    <div className="issue-share" onBlur={closeOnFocusOut} ref={wrapRef}>
      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Share issue ${issueKey}`}
        className="icon-button"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        title="Share"
        type="button"
      >
        <Share2 aria-hidden="true" size={15} />
      </button>
      {open ? (
        <IssueSharePopover
          id={popoverId}
          issueKey={issueKey}
          links={{ short: appUrl(issueKeyRoute(issueKey)), full: appUrl(issueRoute(projectId, issueId)) }}
        />
      ) : null}
    </div>
  );
}

/**
 * The popover's two rows and its one answer line.
 *
 * The answer is a single persistent polite region below the rows rather than
 * one per row, and rather than a change of the button's label: a label that
 * turns into "Copied" changes the button's width (§4.16 forbids exactly that),
 * and a line that appears below everything moves no control. The row that was
 * copied also swaps its icon for a check for as long as the line says so.
 *
 * "Copied" goes after two seconds. A failure stays until the next press or
 * until the popover closes: it is an instruction, and two seconds is not long
 * enough to follow one.
 */
function IssueSharePopover({
  id,
  issueKey,
  links,
}: {
  id: string;
  issueKey: string;
  links: Record<LinkKind, string>;
}) {
  const [outcome, setOutcome] = useState<CopyOutcome | null>(null);
  const shortInput = useRef<HTMLInputElement>(null);
  const fullInput = useRef<HTMLInputElement>(null);
  // The press that counts is the latest one. An earlier write that settles
  // after a later one must not overwrite the later answer.
  const latest = useRef(0);

  useEffect(() => {
    if (outcome?.result !== "copied") return;
    const timer = window.setTimeout(() => setOutcome((current) => (current === outcome ? null : current)), 2000);
    return () => window.clearTimeout(timer);
  }, [outcome]);

  const copy = (link: LinkKind) => {
    const seq = ++latest.current;
    writeClipboard(links[link]).then(
      () => {
        if (seq === latest.current) setOutcome({ link, result: "copied", seq });
      },
      () => {
        if (seq !== latest.current) return;
        // The clipboard said no, so the link is put where the reader can take
        // it by hand: focused and selected, one keystroke from their own copy.
        const input = (link === "short" ? shortInput : fullInput).current;
        input?.focus();
        input?.setSelectionRange(0, input.value.length);
        setOutcome({ link, result: "failed", seq });
      },
    );
  };

  return (
    <section aria-label={`Share ${issueKey}`} className="issue-share-popover" id={id} role="dialog">
      <div className="issue-share-links">
        {(["short", "full"] as const).map((link) => (
          <IssueShareRow
            copied={outcome?.link === link && outcome.result === "copied"}
            inputRef={link === "short" ? shortInput : fullInput}
            key={link}
            label={LINK_LABEL[link]}
            onCopy={() => copy(link)}
            url={links[link]}
          />
        ))}
      </div>
      {/* Mounted for as long as the popover is, and empty when there is nothing
          to say, so a screen reader is already watching it when the first
          answer lands (§7 on regions that mount with their text). The answer
          is keyed by its press: the same sentence twice is a new node, and a
          new node is announced again. */}
      <p className="issue-share-status" data-outcome={outcome?.result} role="status">
        {outcome ? <span key={outcome.seq}>{outcomeText(outcome)}</span> : null}
      </p>
    </section>
  );
}

function IssueShareRow({
  label,
  url,
  copied,
  inputRef,
  onCopy,
}: {
  label: string;
  url: string;
  copied: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onCopy: () => void;
}) {
  const inputId = useId();
  return (
    <div className="issue-share-row">
      <label htmlFor={inputId}>{label}</label>
      <div className="issue-share-field">
        {/* A read-only field rather than text: it truncates on one line, keeps
            the whole link a scroll or a selection away (and in `title`), and is
            the one element every browser can select programmatically when the
            clipboard refuses. */}
        <input id={inputId} readOnly ref={inputRef} title={url} type="text" value={url} />
        <button
          aria-label={`Copy ${label.toLowerCase()}`}
          className="secondary-button compact-button"
          onClick={onCopy}
          type="button"
        >
          {copied ? <Check aria-hidden="true" size={13} /> : <Copy aria-hidden="true" size={13} />}
          Copy
        </button>
      </div>
    </div>
  );
}

function outcomeText({ link, result }: CopyOutcome): string {
  const label = LINK_LABEL[link];
  if (result === "copied") return `${label} copied`;
  const what = label.toLowerCase();
  // A phone has no Ctrl+C to press; its way to copy a selection is the
  // long-press menu.
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return coarse
    ? `Couldn’t copy the ${what} automatically. Touch and hold the link above to copy it.`
    : `Couldn’t copy the ${what} automatically. It’s selected — press Ctrl+C or ⌘C to copy it.`;
}
