import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { expect, it } from "vitest";
import { redactDiagnosticValue } from "../src/core/diagnostic-timeline.js";

it("redacts every raw diagnostic source while preserving useful metadata", async () => {
  const diagnostics = {
    lastError: { message: "Authorization: Bearer synthetic_error_token" },
    graphql: { status: "error", cookie: "synthetic_cookie" },
  };
  const context = vm.createContext({
    redactDiagnosticValue,
    currentPowerBrowserContext: { identifier: "demo" },
    SiteType: { UNKNOWN: "unknown" },
    location: { origin: "https://example.test", pathname: "/" },
    getApplicationId: () => null,
    getBearerToken: () => null,
    getCsrfToken: () => null,
    getNextgenLogCsrfToken: () => null,
    powerBrowserDiagnostics: diagnostics,
    powerBrowserHealthIssues: [{ message: "Bearer synthetic_health_token" }],
    applicationAuthState: {
      current: {
        message: "Bearer synthetic_auth_token",
        password: "synthetic_password",
      },
    },
    diagnosticTimeline: { entries: () => [] },
  });
  vm.runInContext(await readFile("src/ui/settings/info.js", "utf8"), context);
  const summary = context.buildPowerBrowserDiagnosticSummary();
  expect(JSON.stringify(summary)).not.toContain("synthetic_");
  expect(summary.application.identifier).toBe("demo");
  expect(summary.dataSources.graphql.status).toBe("error");
  expect(summary.bearer.available).toBe(false);
  expect(diagnostics.lastError.message).toContain("synthetic_error_token");
});
