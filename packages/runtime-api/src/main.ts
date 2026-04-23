import { startHttpServer } from "./httpServer.js";

const host = process.env.AVMS_NEXTCLOUD_SYNC_HOST ?? "127.0.0.1";
const port = Number(process.env.AVMS_NEXTCLOUD_SYNC_PORT ?? "28570");

const state = {
  activeJobId: null as string | null,
  activeJobStartedAt: null as string | null,
  lastCompletedJobAt: null as string | null,
  abortControllers: new Map<string, AbortController>(),
};

startHttpServer(host, port, state);
