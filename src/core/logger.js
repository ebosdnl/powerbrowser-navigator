const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
});

function resolveLevel() {
  try {
    return globalThis.GM_getValue?.("powerBrowserLogLevel", "debug") ?? "warn";
  } catch {
    return "warn";
  }
}

export function createLogger(scope, level = resolveLevel()) {
  const threshold = LEVELS[level] ?? LEVELS.warn;

  function write(method, message, details) {
    if (LEVELS[method] < threshold) return;
    const prefix = `[Power Browser:${scope}]`;
    if (details === undefined) {
      console[method](prefix, message);
    } else {
      console[method](prefix, message, details);
    }
  }

  return Object.freeze({
    child: (childScope) => createLogger(`${scope}:${childScope}`, level),
    debug: (message, details) => write("debug", message, details),
    info: (message, details) => write("info", message, details),
    warn: (message, details) => write("warn", message, details),
    error: (message, details) => write("error", message, details),
  });
}
