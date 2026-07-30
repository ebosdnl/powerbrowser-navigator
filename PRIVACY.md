# Privacy and security

Power Browser Navigator runs locally in your userscript manager. It does not
include analytics, advertising, telemetry, or a Power Browser-operated backend.

## Network access

Power Browser makes requests only to support features you use:

- Betty Blocks application hosts provide runtime artifacts and application data.
- My Betty Blocks provides authenticated application-family and sandbox data.
- GitHub's Releases API is checked periodically for stable Power Browser updates.

The userscript keeps `@connect *` because Betty Blocks applications and assets
can use organization-specific and environment-specific hosts that cannot be
enumerated reliably in advance.

## Local data

Preferences, per-application overrides, update metadata, artifact snapshots,
diagnostic events, and first-run/version state are stored by the userscript
manager on the local browser profile. Settings exports and artifact snapshots
leave the browser only when you explicitly copy, download, or share them.

## Credentials

Power Browser can read authentication material already available to the active
Betty Blocks browser session when a feature requires it. For example, it can use
cookies for sandbox discovery or copy the runtime bearer when explicitly
requested. Power Browser does not send credentials to a Power Browser-operated
service.

Diagnostic exports redact common credential fields, including authorization
headers, cookies, CSRF values, passwords, secrets, and tokens. Review any
exported data before sharing it, because application identifiers, URLs, and
error messages can still be sensitive.

## Security reporting

Do not include live tokens, cookies, private artifacts, or customer data in a
public issue. Reproduce with redacted diagnostics whenever possible.
