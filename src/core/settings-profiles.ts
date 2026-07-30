export type SettingsRecord = Record<string, unknown>;
export type ApplicationProfiles = Record<string, SettingsRecord>;
export type SettingsEditScope = "global" | "application";

export function hasApplicationOverride(
  profiles: ApplicationProfiles,
  identifier: string | null | undefined,
  key: string,
): boolean {
  return Boolean(
    identifier &&
    profiles[identifier] &&
    Object.hasOwn(profiles[identifier], key),
  );
}

export function resolveEffectiveSetting(
  globalValue: unknown,
  profiles: ApplicationProfiles,
  identifier: string | null | undefined,
  key: string,
): unknown {
  return hasApplicationOverride(profiles, identifier, key)
    ? profiles[identifier as string][key]
    : globalValue;
}

export function resolveEditableSetting(
  scope: SettingsEditScope,
  globalValue: unknown,
  profiles: ApplicationProfiles,
  identifier: string | null | undefined,
  key: string,
): unknown {
  return scope === "application"
    ? resolveEffectiveSetting(globalValue, profiles, identifier, key)
    : globalValue;
}

export function setApplicationOverride(
  profiles: ApplicationProfiles,
  identifier: string,
  key: string,
  value: unknown,
): ApplicationProfiles {
  return {
    ...profiles,
    [identifier]: {
      ...(profiles[identifier] || {}),
      [key]: value,
    },
  };
}

export function removeApplicationOverride(
  profiles: ApplicationProfiles,
  identifier: string,
  key: string,
): ApplicationProfiles {
  if (!hasApplicationOverride(profiles, identifier, key)) return profiles;

  const nextProfile = { ...profiles[identifier] };
  delete nextProfile[key];
  const nextProfiles = { ...profiles };
  if (Object.keys(nextProfile).length) nextProfiles[identifier] = nextProfile;
  else delete nextProfiles[identifier];
  return nextProfiles;
}

export function removeApplicationProfile(
  profiles: ApplicationProfiles,
  identifier: string,
): ApplicationProfiles {
  if (!Object.hasOwn(profiles, identifier)) {
    return profiles;
  }
  const nextProfiles = { ...profiles };
  delete nextProfiles[identifier];
  return nextProfiles;
}
