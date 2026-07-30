import type { TaskaApi } from "./TaskaApi";
import { HybridTaskaApi } from "./HybridTaskaApi";
import { MockTaskaApi } from "./mock/MockTaskaApi";
import { RestTaskaApi } from "./rest/RestTaskaApi";

// `||` instead of `??`: CI may pass unset repository variables as empty strings.
const mode = import.meta.env.VITE_TASKA_API_MODE || "hybrid";
// In dev "/api/v1" goes through the Vite proxy to the gateway (see vite.config.ts);
// deployed builds point directly at the gateway via VITE_TASKA_API_BASE_URL.
const baseUrl = import.meta.env.VITE_TASKA_API_BASE_URL || "/api/v1";
const assumeProjectAdmin = import.meta.env.VITE_TASKA_ASSUME_PROJECT_ADMIN === "true";

function createApi(): TaskaApi {
  switch (mode) {
    case "mock":
      return new MockTaskaApi();
    case "rest":
      return new RestTaskaApi(baseUrl);
    default:
      // "hybrid": gateway-backed APIs are live. Membership/member reads use
      // the temporary admin compatibility view until TAS-137 is deployed.
      return new HybridTaskaApi(new RestTaskaApi(baseUrl), assumeProjectAdmin);
  }
}

export const taskaApi: TaskaApi = createApi();
