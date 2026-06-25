import type { TaskaApi } from "./TaskaApi";
import { MockTaskaApi } from "./mock/MockTaskaApi";
import { RestTaskaApi } from "./rest/RestTaskaApi";

const mode = import.meta.env.VITE_TASKA_API_MODE ?? "mock";
const baseUrl = import.meta.env.VITE_TASKA_API_BASE_URL ?? "/api/v1";

export const taskaApi: TaskaApi = mode === "rest" ? new RestTaskaApi(baseUrl) : new MockTaskaApi();
