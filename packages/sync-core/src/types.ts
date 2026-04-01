export type LogFn = (
  level: "info" | "warn" | "error",
  code: string,
  message: string,
  meta: Record<string, unknown>,
) => Promise<void>;
