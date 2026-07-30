const SENSITIVE_KEY =
  /authorization|bearer|cookie|csrf|xsrf|password|secret|token/i;
const SENSITIVE_VALUE =
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi;

export function redactDiagnosticValue(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value.replace(SENSITIVE_VALUE, "[REDACTED]");
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactDiagnosticValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

export function createDiagnosticTimeline({
  limit = 100,
  clock = () => new Date().toISOString(),
} = {}) {
  const entries = [];

  return Object.freeze({
    add({ source, status, message, details }) {
      const entry = Object.freeze({
        timestamp: clock(),
        source: String(source || "general"),
        status: String(status || "info"),
        message: redactDiagnosticValue(String(message || "")),
        ...(details === undefined
          ? {}
          : { details: redactDiagnosticValue(details) }),
      });
      entries.push(entry);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
      return entry;
    },
    entries() {
      return entries.map((entry) => ({ ...entry }));
    },
    clear() {
      entries.length = 0;
    },
  });
}
