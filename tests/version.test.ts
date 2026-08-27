import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compareVersions, isVersionNewer } from "../src/core/version.js";

describe("release versions", () => {
  it("compares tagged semantic versions", () => {
    expect(isVersionNewer("v3.2.6", "3.2.5")).toBe(true);
    expect(isVersionNewer("v3.2.5", "3.2.5")).toBe(false);
    expect(compareVersions("3.10.0", "3.9.9")).toBe(1);
  });

  it("treats a stable release as newer than its prerelease", () => {
    expect(compareVersions("3.2.5", "3.2.5-beta.1")).toBe(1);
    expect(compareVersions("3.2.5-beta.2", "3.2.5-beta.10")).toBe(-1);
  });

  it("keeps package versions aligned with userscript metadata", async () => {
    const [metadata, packageSource, packageLockSource] = await Promise.all([
      readFile("src/metadata.user.js", "utf8"),
      readFile("package.json", "utf8"),
      readFile("package-lock.json", "utf8"),
    ]);
    const metadataVersion = metadata.match(/^\/\/ @version\s+(\S+)$/m)?.[1];
    const packageVersion = JSON.parse(packageSource).version;
    const packageLock = JSON.parse(packageLockSource);

    expect(metadataVersion).toBeTruthy();
    expect(packageVersion).toBe(metadataVersion);
    expect(packageLock.version).toBe(metadataVersion);
    expect(packageLock.packages[""].version).toBe(metadataVersion);
  });
});
