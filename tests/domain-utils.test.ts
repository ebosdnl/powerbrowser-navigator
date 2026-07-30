import { describe, expect, it } from "vitest";
import {
  csvCell,
  decodeJwtPayload,
  isAuthenticationError,
  normalizeEndpoints,
} from "../src/core/domain-utils.js";

describe("domain utilities", () => {
  it("normalizes array and keyed endpoint collections", () => {
    const endpoint = { url: "/orders/:id" };
    expect(normalizeEndpoints([endpoint])).toEqual([endpoint]);
    expect(normalizeEndpoints({ order: endpoint })).toEqual([endpoint]);
    expect(normalizeEndpoints(null)).toEqual([]);
  });

  it("escapes values for the log CSV format", () => {
    expect(csvCell('one "two"')).toBe('"one ""two"""');
    expect(csvCell(null)).toBe('""');
  });

  it("decodes URL-safe JWT payloads and rejects malformed tokens", () => {
    const payload = { application_id: "app-1" };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const decode = (value: string) =>
      Buffer.from(value, "base64").toString("utf8");
    expect(decodeJwtPayload(`Bearer x.${encoded}.y`, decode)).toEqual(payload);
    expect(decodeJwtPayload("invalid", decode)).toBeNull();
  });

  it("recognizes HTTP-200 GraphQL authentication failures", () => {
    expect(
      isAuthenticationError([
        {
          message: "Access token has expired",
          extensions: { code: "UNAUTHENTICATED" },
        },
      ]),
    ).toBe(true);
    expect(
      isAuthenticationError([{ message: "You cannot edit this application" }]),
    ).toBe(false);
  });
});
