export type AuthStatus =
  "idle" | "loading" | "reauthenticating" | "ready" | "manual-login-required";

export interface AuthSnapshot {
  readonly status: AuthStatus;
  readonly message: string;
  readonly updatedAt: string;
  readonly [key: string]: unknown;
}

export type AuthSubscriber = (
  snapshot: AuthSnapshot,
  previous: AuthSnapshot | null,
) => void;

export interface DiagnosticEventInput {
  source?: string;
  status?: string;
  message?: string;
  details?: unknown;
}

export interface DiagnosticEntry {
  readonly timestamp: string;
  readonly source: string;
  readonly status: string;
  readonly message: string;
  readonly details?: unknown;
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
  child(scope: string): Logger;
  debug(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

export type FeatureMethod<TContext> = (
  context: TContext,
) => void | Promise<void>;

export interface Feature<TContext = unknown> {
  name: string;
  start?: FeatureMethod<TContext>;
  sync?: FeatureMethod<TContext>;
  stop?: FeatureMethod<TContext>;
}

export interface SettingsTab {
  id: string;
  label: string;
}

export type SettingType = "toggle" | "shortcut" | "theme" | "size" | "number";

export interface SettingDefinition {
  key: string;
  tab: string;
  label: string;
  description: string;
  type: SettingType;
  defaultValue: unknown;
  section?: string;
  [key: string]: unknown;
}
