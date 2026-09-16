import type { TaskaApi } from "./TaskaApi";
import { HybridTaskaApi } from "./HybridTaskaApi";
import { MockTaskaApi } from "./mock/MockTaskaApi";
import { RestTaskaApi } from "./rest/RestTaskaApi";

// `||` instead of `??`: CI may pass unset repository variables as empty strings.
const mode = import.meta.env.VITE_TASKA_API_MODE || "hybrid";
// In dev "/api/v1" goes through the Vite proxy to the gateway (see vite.config.ts);
// deployed builds point directly at the gateway via VITE_TASKA_API_BASE_URL.
const baseUrl = import.meta.env.VITE_TASKA_API_BASE_URL || "/api/v1";

function createApi(): TaskaApi {
  switch (mode) {
    case "mock":
      return new MockTaskaApi();
    case "rest":
      return new RestTaskaApi(baseUrl);
    default:
      // "hybrid": a pass-through to the gateway since TAS-224, kept as the
      // default until TAS-209 switches it to "rest" and deletes the class.
      return new HybridTaskaApi(new RestTaskaApi(baseUrl));
  }
}

export const taskaApi: TaskaApi = createApi();
