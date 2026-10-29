import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsConnectedAppsSection } from "./SettingsConnectedAppsSection";

const { api } = vi.hoisted(() => ({ api: { getCurrentUser: vi.fn(), listConnectedApps: vi.fn(), revokeConnectedApp: vi.fn() } }));
vi.mock("../../api/client", () => ({ taskaApi: api }));
const app = { appId: "client-1", name: "Claude", host: "claude.ai", metadataUrl: null, scopes: ["read", "future_scope"], connectedAt: "2026-10-20T10:00:00Z", lastUsedAt: "2026-10-28T12:40:00Z", expiresAt: "2026-11-27T10:00:00Z" };
const draw = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><SettingsConnectedAppsSection /></QueryClientProvider>);
beforeEach(() => { vi.resetAllMocks(); api.getCurrentUser.mockResolvedValue({ id: "user-1" }); api.listConnectedApps.mockResolvedValue({ available: true, items: [app] }); });
describe("Connected apps", () => {
  it("shows server values and an unknown scope; cancels and confirms revoke", async () => {
    api.revokeConnectedApp.mockResolvedValue(undefined);
    draw();
    expect(await screen.findByText("claude.ai")).toBeVisible();
    expect(screen.getByText("Access: read, future_scope")).toBeVisible();
    expect(screen.getByText(/Token last issued/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.revokeConnectedApp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect app" }));
    await waitFor(() => expect(api.revokeConnectedApp).toHaveBeenCalledWith("client-1"));
    expect(await screen.findByText("No connected apps.")).toBeVisible();
  });
  it("distinguishes disabled from empty and a 503", async () => {
    api.listConnectedApps.mockResolvedValue({ available: false, items: [] });
    const { unmount } = draw();
    expect(await screen.findByText(/OAuth is turned off/)).toBeVisible();
    unmount();
    api.listConnectedApps.mockRejectedValue(Object.assign(new Error("Unavailable"), { status: 503, requestId: "req-1" }));
    draw();
    expect(await screen.findByText("Connected apps could not be loaded.")).toBeVisible();
    expect(screen.queryByText("No connected apps.")).toBeNull();
  });
  it("optimistically removes and restores a failed revoke", async () => {
    let reject!: (reason: Error) => void;
    api.revokeConnectedApp.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    draw();
    await screen.findByText("Claude");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect app" }));
    expect(await screen.findByText("No connected apps.")).toBeVisible();
    reject(Object.assign(new Error("Service unavailable"), { status: 503, requestId: "req-503" }));
    expect(await screen.findByText("Claude")).toBeVisible();
    expect(await screen.findByText(/could not confirm that Claude was disconnected/)).toBeVisible();
    expect(screen.getByText("Service unavailable")).toBeVisible();
    expect(screen.getByText("req-503")).toBeVisible();
  });
  it("discards a late pre-revoke GET after a successful DELETE, including across remount", async () => {
    let finishDelete!: () => void;
    let finishRead!: (value: { available: boolean; items: typeof app[] }) => void;
    api.revokeConnectedApp.mockReturnValue(new Promise<void>((resolve) => { finishDelete = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const element = <QueryClientProvider client={client}><SettingsConnectedAppsSection /></QueryClientProvider>;
    const first = render(element);
    await screen.findByText("Claude");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect app" }));
    await screen.findByText("No connected apps.");
    first.unmount();
    api.listConnectedApps.mockReturnValue(new Promise((resolve) => { finishRead = resolve; }));
    render(element);
    void client.invalidateQueries({ queryKey: ["connected-apps", "user-1"] });
    await waitFor(() => expect(api.listConnectedApps.mock.calls.length).toBeGreaterThanOrEqual(3));
    await act(async () => { finishDelete(); });
    await act(async () => { finishRead({ available: true, items: [app] }); });
    expect(screen.queryByText("Claude")).toBeNull();
    expect(client.getQueryData(["connected-apps", "user-1"])).toEqual({ available: true, items: [] });
  });

  it("reconciles concurrent revokes independently when a remount starts a stale read", async () => {
    const second = { ...app, appId: "client-2", name: "Other app" };
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    let finishRead!: (value: { available: boolean; items: typeof app[] }) => void;
    api.listConnectedApps.mockResolvedValue({ available: true, items: [app, second] });
    api.revokeConnectedApp.mockImplementation((id: string) => new Promise<void>((resolve) => {
      if (id === app.appId) finishFirst = resolve;
      else finishSecond = resolve;
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const element = <QueryClientProvider client={client}><SettingsConnectedAppsSection /></QueryClientProvider>;
    const first = render(element);
    await screen.findByText("Claude");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect app" }));
    await waitFor(() => expect(screen.queryByText("Claude")).toBeNull());
    first.unmount();
    render(element);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Other app" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect app" }));
    await screen.findByText("No connected apps.");
    api.listConnectedApps.mockReturnValue(new Promise((resolve) => { finishRead = resolve; }));
    void client.invalidateQueries({ queryKey: ["connected-apps", "user-1"] });
    await waitFor(() => expect(api.listConnectedApps.mock.calls.length).toBeGreaterThanOrEqual(3));
    await act(async () => { finishSecond(); });
    await act(async () => { finishFirst(); });
    await act(async () => { finishRead({ available: true, items: [app, second] }); });
    expect(client.getQueryData(["connected-apps", "user-1"])).toEqual({ available: true, items: [] });
  });

});
