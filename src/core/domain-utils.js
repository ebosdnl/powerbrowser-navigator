export function normalizeEndpoints(endpoints) {
  if (Array.isArray(endpoints)) return endpoints;
  if (endpoints && typeof endpoints === "object")
    return Object.values(endpoints);
  return [];
}

export function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function decodeJwtPayload(token, decode = globalThis.atob) {
  const payload = String(token ?? "")
    .replace(/^Bearer\s+/i, "")
    .split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(decode(padded));
  } catch {
    return null;
  }
}
