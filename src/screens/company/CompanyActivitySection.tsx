import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { taskaApi } from "../../api/client";
import { apiErrorFacts, isWorkspaceClosed } from "../../api/errors";
import { ACTIVITY_KINDS, type ActivityRecord, type CompanyActivityPage } from "../../api/tenantActivity";
import { ApiNotice } from "../../components/ApiNotice";
import { ErrorNote } from "../../components/ErrorNote";
import { useCompanyName } from "../../hooks/useCompanies";
import { useCompanyAddress } from "../../lib/companyAddress";
import { shortKey } from "../admin/columns";
import {
  activityKey,
  activityParams,
  companyActivityOptions,
  isActivityActorId,
  isFiltered,
  readActivityFilters,
  retryActivity,
  writeActivityFilters,
  type ActivityFilters,
} from "./companyActivityQuery";
import {
  AUTHOR_LINK_HINT,
  CONTINUE_REFUSED_TEXT,
  EMPTY_FILTERED_TEXT,
  END_FILTERED_TEXT,
  END_TEXT,
  FILTERS_REFUSED_TEXT,
  KIND_GROUPS,
  KIND_LABELS,
  LOADING_TEXT,
  PLATFORM_MARK,
  REFRESH_FAILED_TEXT,
  TIME_UNKNOWN,
  activitySentence,
  activityWhen,
  activityWhenFull,
  actorName,
  continuationFailedText,
  deniedText,
  emptyText,
  firstPageFailedText,
  isActivityDenied,
  isActivityRefused,
  kindChipLabel,
  leadText,
  showsPlatformMark,
  showsServerWords,
  unknownKindCode,
} from "./companyActivityText";

/**
 * Company › Activity (TAS-524, DESIGN.md §4.41, §5.10) — the B2B build only:
 * who changed what in the tab's company, newest first, for its admins and its
 * owner. It only reads.
 *
 * On the mock, against the contract the frontend proposed on TAS-523 — **not
 * in the blueprint** (docs/ai/API-DIVERGENCE.md «TAS-524»). What it keeps to:
 *
 * - **Nothing is derived** (api-contract-guard B5): every record, name and
 *   platform mark is the answer's; rows are never sorted, merged, grouped,
 *   counted or hidden, and «Show more» appends in the server's order. No
 *   record is added after one's own write — it shows on the next entry.
 * - **The first page is the only cached page** (B4): an entry, «Try again»,
 *   «Start again» and a change of filter read it, and the pages «Show more»
 *   added are dropped, never re-read. A failed first page is read again on
 *   return to the tab; a failed continuation only by its own «Show more».
 * - **The server is the authority** (B6, B9): a member who opens the address
 *   gets the server's 403, drawn as a refusal with its id — never as an empty
 *   log; the client gates nothing but the rail's item.
 * - **The filters are the address** (B7): `actorUserId` and `kind`, written
 *   with `replace`; an author id that is not a UUID is removed, never sent.
 */
export function CompanyActivitySection() {
  const address = useCompanyAddress();
  if (address?.companyId == null) return null;
  return <CompanyActivity companyId={address.companyId} />;
}

const heading = () => document.querySelector<HTMLElement>(".settings-area .area-section-title");

/** The pages «Show more» added after one first page, and the continuation's own state (B4). */
interface Continuation {
  /** The first page these continue — another one (a re-read, a new filter) drops them. */
  base: CompanyActivityPage;
  pages: CompanyActivityPage[];
  busy: boolean;
  /** The last continuation's failure, kept while «Show more» is out again and gone with its success. */
  error: unknown;
}

/** Where focus goes once the section has drawn what an action changed (§4.41 «Фокус»). */
type FocusTarget =
  | { to: "heading" }
  | { to: "add" }
  | { to: "kind-chip" }
  | { to: "author-chip" }
  | { to: "state-button" }
  | { to: "start-again" }
  | { to: "row"; key: string };

/** A row's key, scoped to its page (B4): its id — a repeated one numbered — or, without one, its place. */
function keyedRows(page: CompanyActivityPage, index: number): { key: string; record: ActivityRecord }[] {
  const seen = new Map<string, number>();
  return page.items.map((record, position) => {
    if (record.id === null) return { key: `${index}:#${position}`, record };
    const count = seen.get(record.id) ?? 0;
    seen.set(record.id, count + 1);
    return { key: count === 0 ? `${index}:${record.id}` : `${index}:${record.id}#${count}`, record };
  });
}

/** A continuation page, retried once when its answer never came — the first page's rule (B3). */
async function readPage(companyId: string, filters: ActivityFilters, cursor: string): Promise<CompanyActivityPage> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await taskaApi.listTenantActivity(companyId, activityParams(filters, cursor));
    } catch (error) {
      if (!retryActivity(attempt, error)) throw error;
    }
  }
}

function CompanyActivity({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const company = useCompanyName(companyId);
  const [searchParams, setSearchParams] = useSearchParams();
  const read = readActivityFilters(searchParams);
  const filters: ActivityFilters = { actorUserId: read.actorUserId, kinds: read.kinds };
  const filterKey = JSON.stringify(activityKey(filters));
  const filtered = isFiltered(filters);
  const first = useQuery(companyActivityOptions(companyId, filters));
  // A first page that did not load stays drawn while it is read again — «Try
  // again», or the return to the tab — with its button `aria-disabled`
  // (§4.40's recipe): a re-read of a query with no data is `pending` again,
  // and would otherwise put the skeleton in the refusal's place. Kept per
  // filter, from the render that sees it; gone with an answer.
  const [failure, setFailure] = useState<{ key: string; error: unknown; at: number } | null>(null);
  if (first.isError && (failure === null || failure.key !== filterKey || failure.at !== first.errorUpdatedAt)) {
    setFailure({ key: filterKey, error: first.error, at: first.errorUpdatedAt });
  } else if (first.isSuccess && failure !== null) {
    setFailure(null);
  }
  const shownFailure =
    first.data !== undefined
      ? null
      : first.isError
        ? { error: first.error }
        : first.isFetching && failure !== null && failure.key === filterKey
          ? { error: failure.error }
          : null;
  const hintId = useId();
  const plane = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // An author id that is not a UUID is never sent, and goes from the address (B7).
  const badActor = read.badActor;
  useEffect(() => {
    if (!badActor) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("actorUserId");
        return next;
      },
      { replace: true },
    );
  }, [badActor, setSearchParams]);

  const [said, setSaid] = useState<{ text: string; seq: number } | null>(null);
  const say = useCallback((text: string) => setSaid((current) => ({ text, seq: (current?.seq ?? 0) + 1 })), []);

  const [continuation, setContinuation] = useState<Continuation | null>(null);
  /** The name of the author a row's link was followed from — a loaded record's — until the new filter's rows name them. */
  const [authorHint, setAuthorHint] = useState<{ id: string; label: string } | null>(null);
  const more = continuation !== null && continuation.base === first.data ? continuation : null;
  const firstData = useRef(first.data);
  useLayoutEffect(() => {
    firstData.current = first.data;
  });

  // Focus after an action, once the frame it changed has been drawn: on every
  // commit the pending target is looked for, and taken the first time it is
  // there (for a change of filter, only once the address holds that filter).
  const pendingFocus = useRef<{ target: FocusTarget; whenKey: string | null } | null>(null);
  // Bumped only to make sure a commit follows a request for focus made after the last one.
  const [, setFocusTick] = useState(0);
  const addRef = useRef<HTMLButtonElement>(null);
  const kindChipRef = useRef<HTMLButtonElement>(null);
  const authorChipRef = useRef<HTMLSpanElement>(null);
  const stateButtonRef = useRef<HTMLButtonElement>(null);
  const startAgainRef = useRef<HTMLButtonElement>(null);
  const focusLater = useCallback((target: FocusTarget, whenKey: string | null = null) => {
    pendingFocus.current = { target, whenKey };
    setFocusTick((tick) => tick + 1);
  }, []);
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (pending === null || (pending.whenKey !== null && pending.whenKey !== filterKey)) return;
    const { target } = pending;
    let node: HTMLElement | null = null;
    switch (target.to) {
      case "heading":
        node = heading();
        break;
      case "add":
        node = addRef.current ?? kindChipRef.current ?? heading();
        break;
      case "kind-chip":
        node = kindChipRef.current;
        break;
      case "author-chip":
        node = authorChipRef.current;
        break;
      case "state-button":
        node = stateButtonRef.current ?? heading();
        break;
      case "start-again":
        node = startAgainRef.current;
        break;
      case "row":
        node = plane.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(target.key)}"]`) ?? null;
        break;
    }
    if (node === null) return;
    pendingFocus.current = null;
    if (target.to === "row") {
      node.focus({ preventScroll: true });
      // Into view without a glide, with or without reduced motion (§4.9, §4.24).
      node.scrollIntoView({ block: "nearest" });
    } else {
      node.focus();
    }
  });

  /** 403 arrived while focus was in the section (or nowhere): the heading takes it (§4.41 «Фокус»). */
  const focusHeadingIfInside = useCallback(() => {
    const active = document.activeElement;
    if (active === null || active === document.body || plane.current?.contains(active)) focusLater({ to: "heading" });
  }, [focusLater]);

  /** The filter whose first page the section is reading — an answer for another is nobody's to settle. */
  const activeKey = useRef(filterKey);
  useLayoutEffect(() => {
    activeKey.current = filterKey;
  }, [filterKey]);

  /** What a refused first page says in the status region — the sentence of the notice it draws (§4.41). */
  const firstPageSentence = useCallback(
    (error: unknown, withFilters: boolean) => {
      if (isActivityDenied(error)) return deniedText(company);
      if (withFilters && isActivityRefused(error)) return FILTERS_REFUSED_TEXT;
      return firstPageFailedText(error);
    },
    [company],
  );

  /**
   * A first page read because the reader asked for it — a change of filter,
   * «Clear filters», «Try again», «Start again» — and how it ended: the status
   * region says an empty end and a refusal, and stays silent on rows; focus,
   * where the action moves it on its end.
   */
  const settle = useCallback(
    (action: "filter" | "again", key: string, withFilters: boolean, outcome: { page: CompanyActivityPage } | { error: unknown }) => {
      if (!mounted.current || activeKey.current !== key) return;
      if ("error" in outcome) {
        if (isWorkspaceClosed(outcome.error)) return;
        say(firstPageSentence(outcome.error, withFilters));
        if (isActivityDenied(outcome.error)) focusHeadingIfInside();
        else if (action === "again") focusLater({ to: "state-button" });
        return;
      }
      const empty = outcome.page.items.length === 0;
      if (empty) say(withFilters ? EMPTY_FILTERED_TEXT : emptyText(company));
      if (action === "again") focusLater({ to: "heading" });
    },
    [company, firstPageSentence, focusHeadingIfInside, focusLater, say],
  );
  /** A change of filter (§4.41 «Адрес»): written with `replace`, read from its first page, its rows never the old filter's. */
  const changeFilters = (next: ActivityFilters, focus: FocusTarget) => {
    const nextKey = activityKey(next);
    const key = JSON.stringify(nextKey);
    if (key === filterKey) {
      focusLater(focus);
      return;
    }
    // Under the new chip, the skeleton until its own first page answers.
    queryClient.removeQueries({ queryKey: nextKey, exact: true });
    setContinuation(null);
    activeKey.current = key;
    focusLater(focus, key);
    setSearchParams((current) => writeActivityFilters(current, next), { replace: true });
    void queryClient.fetchQuery(companyActivityOptions(companyId, next)).then(
      (page) => settle("filter", key, isFiltered(next), { page }),
      (error: unknown) => settle("filter", key, isFiltered(next), { error }),
    );
  };

  const clearFilters = () => changeFilters({ actorUserId: null, kinds: [] }, { to: "add" });

  /** «Try again» on a first page that did not load: the refusal stays drawn while it is out (§4.40's recipe). */
  const tryAgain = () => {
    if (first.isFetching) return;
    const key = filterKey;
    void first.refetch().then((result) => {
      settle("again", key, filtered, result.isSuccess ? { page: result.data } : { error: result.error });
    });
  };

  /** «Start again from the newest» after a continuation was refused 400: the first page, the read pages dropped. */
  const startAgain = () => {
    const key = filterKey;
    const queryKey = activityKey(filters);
    setContinuation(null);
    void queryClient.resetQueries({ queryKey, exact: true }).then(() => {
      const state = queryClient.getQueryState<CompanyActivityPage>(queryKey);
      if (state?.status === "success" && state.data) settle("again", key, filtered, { page: state.data });
      else if (state?.status === "error") settle("again", key, filtered, { error: state.error });
    });
  };

  /** «Show more»: the next page by the last one's cursor, appended in the server's order (B4). */
  const showMore = () => {
    const base = first.data;
    if (base === undefined || more?.busy) return;
    const pages = more?.pages ?? [];
    const cursor = (pages[pages.length - 1] ?? base).nextCursor;
    if (cursor === null) return;
    const key = filterKey;
    setContinuation({ base, pages, busy: true, error: more?.error ?? null });
    void readPage(companyId, filters, cursor).then(
      (page) => {
        if (!mounted.current || firstData.current !== base || activeKey.current !== key) return;
        setContinuation({ base, pages: [...pages, page], busy: false, error: null });
        // Focus to the first new row — it announces the success (§4.9); an empty page has none, and focus stays.
        const firstNew = keyedRows(page, pages.length + 1)[0];
        if (firstNew) focusLater({ to: "row", key: firstNew.key });
      },
      (error: unknown) => {
        if (!mounted.current || firstData.current !== base || activeKey.current !== key) return;
        setContinuation({ base, pages, busy: false, error });
        if (isWorkspaceClosed(error)) return;
        if (isActivityDenied(error)) {
          say(deniedText(company));
          focusHeadingIfInside();
        } else if (isActivityRefused(error)) {
          say(CONTINUE_REFUSED_TEXT);
          focusLater({ to: "start-again" });
        } else {
          say(continuationFailedText(error));
        }
      },
    );
  };

  // Every 403 drops the rows, the filter row and the foot (B9).
  const firstFailure = shownFailure !== null ? shownFailure.error : first.isError ? first.error : null;
  const deniedError =
    firstFailure !== null && isActivityDenied(firstFailure)
      ? firstFailure
      : more !== null && more.error !== null && isActivityDenied(more.error)
        ? more.error
        : null;
  const denied = deniedError !== null;
  const closed = firstFailure !== null && isWorkspaceClosed(firstFailure);

  // The newest loaded record by this author names the chip (§4.41 «Фильтр по автору»).
  const pages = first.data ? [first.data, ...(more?.pages ?? [])] : [];
  // The first row of a page «Show more» added is where focus lands (§4.41 «Подвал»).
  const rows = pages.flatMap((page, index) => keyedRows(page, index).map((row, position) => ({ ...row, target: index > 0 && position === 0 })));
  const lastPage = pages[pages.length - 1];
  const authorRecord = filters.actorUserId === null ? undefined : rows.find(({ record }) => record.actor?.userId === filters.actorUserId);
  const author =
    filters.actorUserId === null
      ? null
      : authorRecord
        ? { label: actorName(authorRecord.record.actor), id: false }
        : authorHint !== null && authorHint.id === filters.actorUserId
          ? { label: authorHint.label, id: false }
          : { label: shortKey(filters.actorUserId), id: true };

  const linkFor = (actorUserId: string) => {
    const next = writeActivityFilters(searchParams, { ...filters, actorUserId });
    return `?${next.toString()}`;
  };
  const followAuthor = (event: MouseEvent<HTMLAnchorElement>, record: ActivityRecord, actorUserId: string) => {
    // A click meant for a new tab or window leaves this view as it is.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // The chip is named from the start, not by its id while the filtered page is out.
    setAuthorHint({ id: actorUserId, label: actorName(record.actor) });
    changeFilters({ ...filters, actorUserId }, { to: "author-chip" });
  };
  const authorLink = (record: ActivityRecord) => {
    const id = record.actor?.userId ?? null;
    // A link that would change nothing is not drawn (§5.8).
    return isActivityActorId(id) && id !== filters.actorUserId ? id : null;
  };

  const failureBlock = (error: unknown) => {
    const refusedFilters = filtered && isActivityRefused(error);
    return (
      <div className="company-activity-failure">
        <ApiNotice error={error} live="off" words={!refusedFilters && showsServerWords(error)}>
          {refusedFilters ? FILTERS_REFUSED_TEXT : firstPageFailedText(error)}
        </ApiNotice>
        {refusedFilters ? (
          <button className="secondary-button compact-button company-activity-state-button" onClick={clearFilters} ref={stateButtonRef} type="button">
            Clear filters
          </button>
        ) : (
          <button
            aria-disabled={first.isFetching || undefined}
            className="secondary-button compact-button company-activity-state-button"
            onClick={tryAgain}
            ref={stateButtonRef}
            type="button"
          >
            Try again
          </button>
        )}
      </div>
    );
  };

  const moreError = more !== null && more.error !== null && !denied && !isWorkspaceClosed(more.error) ? more.error : null;
  const cursorRefused = moreError !== null && isActivityRefused(moreError);
  const moreStatus = moreError === null ? null : apiErrorFacts(moreError).status;

  return (
    <div className="settings-plane" ref={plane}>
      <div className="settings-column company-activity">
        <p className="settings-lead">{leadText(company)}</p>

        {denied ? null : (
          <ActivityFilterRow
            addRef={addRef}
            author={author}
            authorChipRef={authorChipRef}
            filters={filters}
            kindChipRef={kindChipRef}
            onApplyKind={(kind) => changeFilters({ ...filters, kinds: [kind] }, { to: "kind-chip" })}
            onRemoveAuthor={() => changeFilters({ ...filters, actorUserId: null }, { to: "add" })}
            onRemoveKinds={() => changeFilters({ ...filters, kinds: [] }, { to: "add" })}
          />
        )}

        {denied ? (
          <div className="company-activity-failure">
            <ApiNotice error={deniedError} live="off" words={false}>
              {deniedText(company)}
            </ApiNotice>
          </div>
        ) : closed ? null : first.data === undefined ? (
          shownFailure !== null ? (
            failureBlock(shownFailure.error)
          ) : (
            <ActivityLoading />
          )
        ) : (
          <>
            {first.isError ? (
              <div className="company-activity-failure">
                <ApiNotice error={first.error} live="off" words={false}>
                  {REFRESH_FAILED_TEXT}
                </ApiNotice>
              </div>
            ) : null}
            {rows.length === 0 ? (
              filtered ? (
                <div className="company-activity-empty-block">
                  <p className="company-activity-empty">{EMPTY_FILTERED_TEXT}</p>
                  <button className="secondary-button compact-button company-activity-state-button" onClick={clearFilters} ref={stateButtonRef} type="button">
                    Clear filters
                  </button>
                </div>
              ) : (
                <p className="company-activity-empty">{emptyText(company)}</p>
              )
            ) : (
              <>
                <ul aria-busy={first.isFetching || undefined} aria-label="Activity" className="company-activity-list">
                  {rows.map(({ key, record, target }) => (
                    <ActivityRow
                      authorLink={authorLink(record)}
                      followAuthor={followAuthor}
                      hintId={hintId}
                      key={key}
                      linkFor={linkFor}
                      record={record}
                      rowKey={key}
                      target={target}
                    />
                  ))}
                </ul>
                <div className="company-activity-foot">
                  {moreError !== null ? (
                    <ErrorNote
                      requestId={apiErrorFacts(moreError).requestId}
                      serverWords={!cursorRefused && moreStatus !== null && moreStatus >= 500 ? apiErrorFacts(moreError).message : null}
                    >
                      {cursorRefused ? CONTINUE_REFUSED_TEXT : continuationFailedText(moreError)}
                    </ErrorNote>
                  ) : null}
                  {cursorRefused ? (
                    <button className="secondary-button compact-button company-activity-state-button" onClick={startAgain} ref={startAgainRef} type="button">
                      Start again from the newest
                    </button>
                  ) : lastPage?.nextCursor ? (
                    <button
                      aria-disabled={more?.busy || undefined}
                      aria-label="Show more activity"
                      className="secondary-button compact-button list-more-button"
                      data-busy={more?.busy || undefined}
                      onClick={showMore}
                      type="button"
                    >
                      Show more
                    </button>
                  ) : (
                    <p className="company-activity-end">{filtered ? END_FILTERED_TEXT : END_TEXT}</p>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* The authors' links' one description (§4.41). */}
        <span hidden id={hintId}>
          {AUTHOR_LINK_HINT}
        </span>
        {/* One persistent region, a node per sentence (§4.38 «Итоги»): it says only how the
            reader's own action ended — an empty end or a refusal — and nothing on entry. */}
        <div className="visually-hidden" role="status">
          {said ? <span key={said.seq}>{said.text}</span> : null}
        </div>
      </div>
    </div>
  );
}

function ActivityLoading() {
  return (
    <>
      <span className="visually-hidden" role="status">
        {LOADING_TEXT}
      </span>
      <ul aria-busy="true" aria-label="Activity" className="company-activity-list">
        {[0, 1, 2].map((row) => (
          <li aria-hidden="true" className="company-activity-row company-activity-skeleton" key={row}>
            <span className="value-skeleton company-activity-skeleton-sentence" />
            <span className="value-skeleton company-activity-skeleton-meta" />
          </li>
        ))}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ a row */

function ActivityRow({
  record,
  rowKey,
  target,
  authorLink,
  linkFor,
  followAuthor,
  hintId,
}: {
  record: ActivityRecord;
  rowKey: string;
  /** The first row of a page «Show more» added: focus lands here (`tabIndex=-1`, not a Tab stop). */
  target: boolean;
  authorLink: string | null;
  linkFor: (actorUserId: string) => string;
  followAuthor: (event: MouseEvent<HTMLAnchorElement>, record: ActivityRecord, actorUserId: string) => void;
  hintId: string;
}) {
  const sentence = activitySentence(record);
  const code = unknownKindCode(record);
  const mark = showsPlatformMark(record.actor);
  return (
    <li className="company-activity-row" data-row-key={rowKey} tabIndex={target ? -1 : undefined}>
      <p className="company-activity-sentence">
        {sentence.notDone ? <span className="company-activity-not-done">Not done: </span> : null}
        {sentence.parts.map((part, index) => {
          if (part.type === "words") return <span key={index}>{part.text}</span>;
          if (part.type === "actor" && authorLink !== null) {
            return (
              <Link
                aria-describedby={hintId}
                className="company-activity-actor"
                key={index}
                onClick={(event) => followAuthor(event, record, authorLink)}
                replace
                title={AUTHOR_LINK_HINT}
                to={linkFor(authorLink)}
              >
                {part.text}
              </Link>
            );
          }
          return (
            <span className="company-activity-named" key={index}>
              {part.text}
            </span>
          );
        })}
      </p>
      <p className="company-activity-meta">
        {record.createdAt !== null ? (
          <time dateTime={record.createdAt} title={activityWhenFull(record.createdAt)}>
            {activityWhen(record.createdAt)}
          </time>
        ) : (
          TIME_UNKNOWN
        )}
        {mark ? (
          <>
            {" "}
            <span aria-hidden="true"> · </span>
            <span className="company-activity-mark">{PLATFORM_MARK}</span>
          </>
        ) : null}
        {code !== null ? (
          <>
            {" "}
            <span aria-hidden="true"> · </span>
            <span className="company-activity-code">{code}</span>
          </>
        ) : null}
      </p>
    </li>
  );
}

/* ------------------------------------------------------------ the filters */

/**
 * The filter row (§4.41 «Ряд фильтров»): the author's chip, the kind's chip
 * and «+ Filter», left, wrapping. The author is set from a row's link and
 * only removed here — no people picker, no directory read (art-director B5);
 * the kind from a popover of one labelled select, anchored left. One kind is
 * set from here; an address with several is drawn as one chip.
 */
function ActivityFilterRow({
  filters,
  author,
  onApplyKind,
  onRemoveKinds,
  onRemoveAuthor,
  addRef,
  kindChipRef,
  authorChipRef,
}: {
  filters: ActivityFilters;
  author: { label: string; id: boolean } | null;
  onApplyKind: (kind: string) => void;
  onRemoveKinds: () => void;
  onRemoveAuthor: () => void;
  addRef: RefObject<HTMLButtonElement | null>;
  kindChipRef: RefObject<HTMLButtonElement | null>;
  authorChipRef: RefObject<HTMLSpanElement | null>;
}) {
  const fieldId = useId();
  const popoverId = useId();
  const root = useRef<HTMLDivElement>(null);
  /** Which control opened the popover — focus returns to it on `Esc`. */
  const [open, setOpen] = useState<"add" | "edit" | null>(null);
  const [draft, setDraft] = useState<string>(ACTIVITY_KINDS[0]);

  const trigger = useCallback(() => (open === "edit" ? kindChipRef.current : addRef.current), [open, addRef, kindChipRef]);

  useEffect(() => {
    if (open === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const from = trigger();
      setOpen(null);
      from?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, trigger]);

  const openToAdd = () => {
    setDraft(ACTIVITY_KINDS[0]);
    setOpen("add");
  };
  const openToEdit = () => {
    // On the kind the chip names — the first of the table's, when the address has several.
    setDraft(ACTIVITY_KINDS.find((kind) => filters.kinds.includes(kind)) ?? ACTIVITY_KINDS[0]);
    setOpen("edit");
  };
  const toggle = (from: "add" | "edit") => {
    if (open === from) {
      setOpen(null);
      trigger()?.focus();
    } else if (from === "add") openToAdd();
    else openToEdit();
  };

  const kindLabel = filters.kinds.length > 0 ? kindChipLabel(filters.kinds) : null;
  const authorName = author === null ? null : `By ${author.label}`;

  return (
    <div className="company-activity-filters" ref={root}>
      {author !== null && authorName !== null ? (
        <span className="admin-filter-chip company-activity-chip">
          {/* Not a button: there is nothing in it to edit (§4.41). */}
          <span className="admin-filter-chip-text company-activity-chip-label" ref={authorChipRef} tabIndex={-1} title={authorName}>
            By {author.id ? <span className="company-activity-chip-id">{author.label}</span> : author.label}
          </span>
          <button aria-label={`Remove filter ${authorName}`} className="admin-filter-chip-remove" onClick={onRemoveAuthor} type="button">
            <X aria-hidden="true" size={13} />
          </button>
        </span>
      ) : null}

      {kindLabel !== null ? (
        <span className="admin-filter-chip company-activity-chip">
          <button
            aria-controls={open === "edit" ? popoverId : undefined}
            aria-expanded={open === "edit"}
            aria-haspopup="dialog"
            className="admin-filter-chip-open"
            onClick={() => toggle("edit")}
            ref={kindChipRef}
            title={kindLabel}
            type="button"
          >
            <span className="admin-filter-chip-text">{kindLabel}</span>
          </button>
          <button aria-label={`Remove filter ${kindLabel}`} className="admin-filter-chip-remove" onClick={onRemoveKinds} type="button">
            <X aria-hidden="true" size={13} />
          </button>
        </span>
      ) : (
        <button
          aria-controls={open === "add" ? popoverId : undefined}
          aria-expanded={open === "add"}
          aria-haspopup="dialog"
          className="admin-filter-add"
          onClick={() => toggle("add")}
          ref={addRef}
          type="button"
        >
          <Plus aria-hidden="true" size={13} />
          Filter
        </button>
      )}

      {open !== null ? (
        <section aria-label="Filter activity" className="admin-filter-popover" id={popoverId} role="dialog">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setOpen(null);
              onApplyKind(draft);
            }}
          >
            {/* Explicitly associated rather than wrapping: a wrapping label takes every option into its name. */}
            <label htmlFor={`${fieldId}-kind`}>
              <span>Action</span>
            </label>
            <select id={`${fieldId}-kind`} onChange={(event) => setDraft(event.target.value)} value={draft}>
              {KIND_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.kinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="admin-filter-actions">
              <button className="secondary-button" type="submit">
                Apply
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
