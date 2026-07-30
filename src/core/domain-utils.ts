interface GraphQLErrorLike {
  message?: unknown;
  code?: unknown;
  extensions?: { code?: unknown };
}

export function normalizeEndpoints(endpoints: unknown): unknown[] {
  if (Array.isArray(endpoints)) return endpoints;
  if (endpoints && typeof endpoints === "object")
    return Object.values(endpoints);
  return [];
}

export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function decodeJwtPayload(
  token: unknown,
  decode: (value: string) => string = globalThis.atob,
): Record<string, unknown> | null {
  const payload = String(token ?? "")
    .replace(/^Bearer\s+/i, "")
    .split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(decode(padded));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function isAuthenticationError(
  errors: GraphQLErrorLike | string | Array<GraphQLErrorLike | string>,
): boolean {
  return (Array.isArray(errors) ? errors : [errors]).some((error) => {
    const structured = error && typeof error === "object" ? error : undefined;
    const code = String(
      structured?.extensions?.code ?? structured?.code ?? "",
    ).toUpperCase();
    const message = String(structured?.message ?? error ?? "");
    return (
      ["UNAUTHENTICATED", "UNAUTHORIZED", "TOKEN_EXPIRED"].includes(code) ||
      /(?:not authenticated|unauthenticated|authentication required|jwt expired|token (?:has )?expired|invalid (?:access )?token)/i.test(
        message,
      )
    );
  });
}
