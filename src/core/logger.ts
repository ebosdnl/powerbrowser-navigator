import type { Logger, LogLevel } from "./types.js";

const LEVELS: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
});

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && value in LEVELS;
}

function resolveLevel(): LogLevel {
  try {
    const value = GM_getValue<unknown>("powerBrowserLogLevel", "debug");
    return isLogLevel(value) ? value : "warn";
  } catch {
    return "warn";
  }
}

export function createLogger(
  scope: string,
  level: LogLevel = resolveLevel(),
): Readonly<Logger> {
  const threshold = LEVELS[level] ?? LEVELS.warn;

  function write(
    method: Exclude<LogLevel, "silent">,
    message: string,
    details?: unknown,
  ) {
    if (LEVELS[method] < threshold) return;
    const prefix = `[Power Browser:${scope}]`;
    if (details === undefined) {
      console[method](prefix, message);
    } else {
      console[method](prefix, message, details);
    }
  }

  return Object.freeze({
    child: (childScope: string) =>
      createLogger(`${scope}:${childScope}`, level),
    debug: (message: string, details?: unknown) =>
      write("debug", message, details),
    info: (message: string, details?: unknown) =>
      write("info", message, details),
    warn: (message: string, details?: unknown) =>
      write("warn", message, details),
    error: (message: string, details?: unknown) =>
      write("error", message, details),
  });
}
