import type { TaskaApi } from "./TaskaApi";
import { HybridTaskaApi } from "./HybridTaskaApi";
import { MockTaskaApi } from "./mock/MockTaskaApi";
import { RestTaskaApi } from "./rest/RestTaskaApi";

const mode = import.meta.env.VITE_TASKA_API_MODE ?? "hybrid";
// In dev "/api/v1" goes through the Vite proxy to the gateway (see vite.config.ts);
// deployments on taska.ozero.dev can point directly at the gateway via env.
const baseUrl = import.meta.env.VITE_TASKA_API_BASE_URL ?? "/api/v1";

function createApi(): TaskaApi {
  switch (mode) {
    case "mock":
      return new MockTaskaApi();
    case "rest":
      return new RestTaskaApi(baseUrl);
    default:
      // "hybrid": auth goes to the real gateway, the rest of the contract
      // is not implemented on the backend yet and is served by the mock.
      return new HybridTaskaApi(new RestTaskaApi(baseUrl), new MockTaskaApi());
  }
}

export const taskaApi: TaskaApi = createApi();
