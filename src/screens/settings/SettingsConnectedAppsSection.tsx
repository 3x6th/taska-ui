import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { taskaApi } from "../../api/client";
import { apiErrorFacts } from "../../api/errors";
import { ApiNotice } from "../../components/ApiNotice";
import { ErrorNote } from "../../components/ErrorNote";
import type { ConnectedApp, ConnectedApps } from "../../domain/types";
import { formatDayWithYearIfOther } from "../../lib/format";
import { ME_QUERY_KEY } from "../../lib/ownAvatarLink";

const keyFor = (userId: string) => ["connected-apps", userId] as const;
const displayDate = (value: string) => Number.isNaN(Date.parse(value)) ? null : formatDayWithYearIfOther(value);

export function SettingsConnectedAppsSection() {
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => taskaApi.getCurrentUser() });
  return (
    <div className="settings-plane">
      <div className="settings-column">
        {me.data ? <ConnectedAppsList key={me.data.id} userId={me.data.id} /> : me.isError ? (
          <div className="token-read-failure">
            <ApiNotice error={me.error} live="off">Your profile could not be loaded.</ApiNotice>
            <button className="secondary-button compact-button" onClick={() => void me.refetch()} type="button">Try again</button>
          </div>
        ) : <Loading />}
      </div>
    </div>
  );
}

function Loading() {
  return <div aria-busy="true" className="token-list-loading"><span className="visually-hidden" role="status">Loading connected apps</span>{[0, 1].map((i) => <div aria-hidden="true" className="token-skeleton-row" key={i}><span className="value-skeleton token-skeleton-name" /><span className="value-skeleton token-skeleton-meta" /></div>)}</div>;
}

function ConnectedAppsList({ userId }: { userId: string }) {
  const client = useQueryClient();
  const key = keyFor(userId);
  const query = useQuery({ queryKey: key, queryFn: () => taskaApi.listConnectedApps(), retry: false });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ id: string; error: unknown } | null>(null);
  const [status, setStatus] = useState("");
  const heading = useRef<HTMLParagraphElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const prefix = useId();
  useEffect(() => {
    if (!pendingFocus.current) return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    (target === "heading" ? heading.current : buttons.current.get(target))?.focus();
  });
  const revoke = useMutation({
    mutationFn: (app: ConnectedApp) => taskaApi.revokeConnectedApp(app.appId),
    onMutate: async (app) => {
      await client.cancelQueries({ queryKey: key });
      const index = client.getQueryData<ConnectedApps>(key)?.items.findIndex((item) => item.appId === app.appId) ?? -1;
      client.setQueryData<ConnectedApps>(key, (current) => current ? { ...current, items: current.items.filter((item) => item.appId !== app.appId) } : current);
      return { index };
    },
    onError: (error, app, context) => {
      client.setQueryData<ConnectedApps>(key, (current) => {
        if (!current || current.items.some((item) => item.appId === app.appId)) return current;
        const items = [...current.items];
        items.splice(Math.max(0, Math.min(context?.index ?? items.length, items.length)), 0, app);
        return { ...current, items };
      });
      setRefusal({ id: app.appId, error });
      setStatus(`Could not confirm that ${app.name} was disconnected.`);
      void client.invalidateQueries({ queryKey: key });
    },
    onSuccess: async (_answer, app) => {
      // A refetch may have started while DELETE was in flight (for example on
      // remount or reconnect). Discard its pre-delete answer and reconcile only
      // this app, leaving other in-flight revocations' cache changes intact.
      await client.cancelQueries({ queryKey: key });
      client.setQueryData<ConnectedApps>(key, (current) => current
        ? { ...current, items: current.items.filter((item) => item.appId !== app.appId) }
        : current);
      setStatus(`${app.name} was disconnected.`);
    },
  });
  const apps = query.data?.items ?? [];
  return (
    <>
      <p className="settings-lead" ref={heading} tabIndex={-1}>Applications connected to Taska can act with the access you gave them.</p>
      <div className="visually-hidden" role="status">{status}</div>
      {query.isPending ? <Loading /> : null}
      {query.isError ? <div className="token-read-failure"><ApiNotice error={query.error} live="off">{query.data ? "Connected apps could not be refreshed. The last loaded list is shown." : "Connected apps could not be loaded."}</ApiNotice><button className="secondary-button compact-button" onClick={() => void query.refetch()} type="button">Try again</button></div> : null}
      {query.data && !query.data.available ? <p className="tokens-unavailable">Connected apps are not available because OAuth is turned off.</p> : null}
      {query.data?.available && apps.length === 0 ? <p className="tokens-empty">No connected apps.</p> : null}
      {query.data?.available && apps.length > 0 ? <ul aria-label="Your connected apps" className="token-list">{apps.map((app, index) => {
        const id = `${prefix}-${app.appId}`;
        const connected = displayDate(app.connectedAt);
        const lastUsed = displayDate(app.lastUsedAt);
        const expires = displayDate(app.expiresAt);
        return <li className="token-row" key={app.appId} onKeyDown={(event) => { if (confirming === app.appId && event.key === "Escape") { setConfirming(null); pendingFocus.current = app.appId; } }}>
          <div className="token-row-text"><p className="token-name">{app.name}</p><p className="token-meta">{app.host}</p><p className="token-meta">Access: {app.scopes.length ? app.scopes.join(", ") : "Not stated"}</p><p className="token-dates">{[connected && `Connected ${connected}`, lastUsed && `Token last issued ${lastUsed}`, expires && `Access expires ${expires}`].filter(Boolean).join(" · ")}</p></div>
          <button aria-controls={confirming === app.appId ? id : undefined} aria-expanded={confirming === app.appId} aria-label={`Disconnect ${app.name}`} className="token-revoke" onClick={() => { setRefusal(null); setConfirming(confirming === app.appId ? null : app.appId); }} ref={(node) => { if (node) buttons.current.set(app.appId, node); else buttons.current.delete(app.appId); }} type="button">Disconnect</button>
          {confirming === app.appId ? <div className="member-confirm token-confirm" id={id}><p className="member-confirm-sentence" id={`${id}-sentence`}>Disconnect {app.name}? Its access will stop and it will need your permission to connect again.</p><div className="member-confirm-actions"><button autoFocus className="secondary-button compact-button" onClick={() => { setConfirming(null); pendingFocus.current = app.appId; }} type="button">Cancel</button><button aria-describedby={`${id}-sentence`} aria-disabled={revoke.isPending || undefined} className="secondary-button compact-button member-confirm-accept" onClick={() => { if (revoke.isPending) return; const next = apps[index + 1] ?? apps[index - 1]; pendingFocus.current = next?.appId ?? "heading"; setConfirming(null); setRefusal(null); revoke.mutate(app); }} type="button">Disconnect app</button></div></div> : null}
          {refusal?.id === app.appId ? <ErrorNote requestId={apiErrorFacts(refusal.error).requestId} serverWords={apiErrorFacts(refusal.error).message}>The server could not confirm that {app.name} was disconnected. Refresh the list to check.</ErrorNote> : null}
        </li>;
      })}</ul> : null}
    </>
  );
}
