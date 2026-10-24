import type { TaskaApi } from "./TaskaApi";
import { MockTaskaApi } from "./mock/MockTaskaApi";
import { RestTaskaApi } from "./rest/RestTaskaApi";

// `||` instead of `??`: CI may pass unset repository variables as empty strings.
// Any value other than "", "rest" and "mock" never reaches this line:
// vite.config.ts refuses it before dev, test or build starts (TAS-209, which
// removed the `hybrid` mode).
const mode = import.meta.env.VITE_TASKA_API_MODE || "rest";
// In dev "/api/v1" goes through the Vite proxy to the gateway (see vite.config.ts);
// deployed builds point directly at the gateway via VITE_TASKA_API_BASE_URL.
const baseUrl = import.meta.env.VITE_TASKA_API_BASE_URL || "/api/v1";

function createApi(): TaskaApi {
  return mode === "mock" ? new MockTaskaApi() : new RestTaskaApi(baseUrl);
}

export const taskaApi: TaskaApi = createApi();
