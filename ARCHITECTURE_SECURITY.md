# Security Model

## Threat Model Overview

The system protects: user accounts, tokens, personal data (history, favorites), admin functionality, provider credentials, and object storage. Threats include account takeover, token theft, API abuse, unauthorized admin access, data exposure via logs, and leaked secrets.

## 1. Authentication

### Password-Based Auth

- **Password hashing**: Argon2id (memory 64MB, iterations 3, parallelism 4) — OWASP-recommended. Falls back to scrypt (N=2^14, r=8, p=1) if Argon2 unavailable.
- **Password policy**: min 10 chars, no composition requirement (length > complexity), max 128 chars, allow Unicode. Reject top-N breached passwords (optional API).
- **Email verification**: required before account usable. Token single-use, 24h expiry, hashed in DB.
- **Password reset**: single-use token, 30min expiry, hashed at rest. Reset revokes all sessions.

### Token Model

| Token         | Format                 | TTL             | Storage                   |
| ------------- | ---------------------- | --------------- | ------------------------- |
| Access token  | JWT RS256 (asymmetric) | 15 min          | Client: Keychain/Keystore |
| Refresh token | Opaque 256-bit random  | 30 days rolling | Server: SHA-256 hash only |

- JWT contains only `sub` (userId), `role`, `iat`, `exp`, `jti`. No PII.
- Refresh tokens stored hashed (SHA-256) in `sessions` table. Raw token never persisted.
- **Rotation**: every refresh issues a new pair; old refresh token immediately revoked.
- **Reuse detection**: if a rotated-out refresh token is used again → likely theft → revoke ALL user sessions, flag security event.
- **Revocation list**: access token `jti` blacklist in Redis with TTL = token remaining life. Enforced on sensitive routes.

### Session / Device Management

- Each device has `deviceId` (UUID generated on install, stored securely)
- Sessions list shows all devices with last-used, platform, isCurrent
- User can revoke individual sessions or all ("sign out all devices")
- Login from new device → security notification (opt-in by default on)

### OAuth (future: Google/Apple)

- Authorization Code + PKCE only (no implicit flow)
- Client sends `code_verifier`; server validates
- Provider `sub` linked to internal user via `user_social_links` table
- Email from provider must be verified by provider

## 2. Authorization (RBAC)

### Roles

| Role        | Capabilities                                                        |
| ----------- | ------------------------------------------------------------------- |
| USER        | Own account, music features                                         |
| MODERATOR   | View admin dashboards, view user info, view logs                    |
| ADMIN       | All moderator + user management, provider management, feature flags |
| SUPER_ADMIN | All admin + role management, system config, account deletion        |

### Enforcement

- **Never trust client-provided roles.** Role comes from the DB on every authenticated request (or a short-lived cached value with DB check for role changes).
- Middleware: `requireRole('ADMIN')` checks user's role from server-side state.
- **Defense in depth**: RBAC at route level + capability checks inside services + admin action audit.
- Permission granularity: `permissions` table maps `(role, action)`. Actions like `user.suspend`, `provider.disable`, `role.change`.
- Admin endpoints under `/api/v1/admin/*` additionally require MFA (TOTP) for any write operation.

### Example Admin Middleware

```typescript
async function requireRole(role: Role) {
  return async (req, reply) => {
    const user = await userService.getById(req.userId); // server-side, not from JWT
    if (!user || !roleRank[user.role] >= roleRank[role]) {
      return reply.code(403).send(forbidden());
    }
    if (requiresMfa(req)) {
      await verifyMfa(req); // TOTP
    }
    await auditLog.record(req, user, req.method, req.url);
  };
}
```

## 3. API Security

### Transport

- TLS 1.2+ (prefer 1.3) everywhere, including internal services
- HSTS, CSP headers, X-Content-Type-Options, X-Frame-Options
- Certificate pinning on mobile client (pinned digest; allow override for staging)
- H2 where supported

### Input Validation

- Zod schemas on every route body/query/params
- Strict: no unknown fields allowed (prevents mass-assignment)
- Length limits everywhere (username ≤ 30, displayName ≤ 50, password 10–128, playlist title ≤ 100)
- URL/domain validation for avatar URLs (reject `javascript:`, SSRF-prone schemes)
- SSRF protection: provider calls go through a proxy that blocks private ranges by default (except whitelisted internal services)

### Rate Limiting

- Sliding window (Redis) per IP, per user, per endpoint group
- Auth endpoints: aggressive limits (10/min/IP)
- Download creation: per-user daily cap
- Search: 30/min per user
- Provider-heavy: 20/min per user
- Admin: 30/min per user + MFA
- 429 with `Retry-After`; exponential backoff guidance

### Abuse Prevention

- Pagination caps (max limit 100)
- Upload size limits (artwork ≤ 5MB, avatar ≤ 5MB)
- Download quota per user (configurable, e.g., max N/day)
- Idempotency keys on `POST /downloads`, `POST /favorites`
- Captcha/poW for register (configurable, staging flag)
- Bot detection: UA validation, request fingerprinting on register/login

## 4. Secrets Management

- Never in code, never committed. All via env / secret manager (Vault, AWS Secrets Manager).
- `.env.example` with placeholders only; `.gitignore` excludes `.env*`
- Provider API keys stored server-side only, never sent to clients
- Object storage credentials only used server-side; clients get signed URLs
- Rotation policy: secrets rotated on staff changes or leak suspicion
- CI never prints env; secrets injected via CI secret store

## 5. Database Security

- Least-privilege DB user for API (`sinc_app`): CRUD on application tables only, no DDL
- Migration user (`sinc_migrate`): DDL only, separate credentials
- Passwords as Argon2id hashes only
- Refresh tokens stored as SHA-256 hashes
- Encrypt sensitive columns (email at rest via pgcrypto optionally)
- Connection via TLS; reject plaintext connections
- Network isolation: DB in private subnet, no public exposure
- Backups encrypted (AES-256) and access-controlled

## 6. Object Storage Security

- Private bucket by default; client access only via signed URLs
- Signed URLs: short expiry (10 min download, 60 min playback), single-object scope, `Content-Disposition` fixed, path whitelist
- URLs signed with server-held key; never expose storage credentials to clients
- Uploads (avatar/artwork) via signed upload URLs with size/type limits
- Lifecycle policy: temp/processing files auto-deleted (24h)
- No public listing

## 7. Mobile Security

### Secure Storage

- Tokens, refresh token, biometric flag → **Keychain (iOS)** / **Android Keystore** via react-native-keychain
- Nothing sensitive in AsyncStorage/plaintext MMKV
- `accessibility` = whenUnlocked for tokens
- Biometric-gated keys for sensitive areas (optional)

### Root/Jailbreak Detection (optional, policy-gated)

- Detects and warns; does not hard-block (respect user autonomy), but disables biometric-gated unlock if detected

### Data Minimization on Device

- No PII in logs, analytics, or crash reports
- Crash reports: Sentry `beforeSend` strips tokens/emails
- Analytics events exclude track titles if privacy setting off (allow generic genre-level only)

### App Transport

- Pin API + provider certs
- Validate WS origin
- Obfuscate release builds (ProGuard/R8, iOS hardening)

## 8. Admin Security

- Admin API isolated routes; MFA required for writes
- Admin tokens: same JWT but role checked + MFA challenge
- All admin actions audited (actor, action, target, before/after, IP hash, timestamp)
- Audit logs append-only (separate table, restricted access)
- Admin IP allow-listing (optional env)
- Suspicious admin patterns → alert + lockout
- Admin accounts: strong password policy + mandatory MFA, no social login

## 9. Logging & Observability Security

- Structured logs with requestId/userId, but:
  - Never log tokens, passwords, refresh tokens, email bodies
  - Redact Authorization header, cookies, secrets in query strings
  - Hash IP addresses in logs (privacy)
- Log retention with purge jobs
- Logs access-restricted to admins; admin log view also audited

## 10. Privacy & Data Protection

- GDPR/CCPA-oriented: right to access, export, delete
- **Account deletion**: identity re-verification (password), confirmation, soft-delete → async purge job removes personal data per retention policy; downloads on device are separate and not touched
- Play history retention: configurable (default 90 days)
- Analytics opt-in; privacy settings toggle personalization
- No sale of data; no third-party tracking SDKs
- Data minimization by design (only what's needed)

## 11. Rate Limit & Quota Summary

| Resource        | Limit                             |
| --------------- | --------------------------------- |
| Register        | 5/hour/IP                         |
| Login           | 10/min/IP + 30/hour/IP            |
| Password reset  | 3/hour/email                      |
| Search          | 30/min/user                       |
| Download create | 50/day/user (default)             |
| Favorites add   | 100/hour/user                     |
| Playlist create | 20/day/user                       |
| History sync    | 1000 entries/batch                |
| Provider calls  | per-provider policy (server-side) |

## 12. Security Testing Checklist

- OWASP ASVS Level 2+ targets
- Automated: SAST (Semgrep/SonarQube), dependency audit (`npm audit` + Dependabot), container scan (Trivy)
- Dynamic: DAST on staging (OWASP ZAP)
- Manual: pentest before production launch; auth + admin focus
- Regression: security test suite (auth bypass, IDOR, rate limit, SSRF, mass assignment)
- Secrets: pre-commit hook (gitleaks) + CI scan

## 13. Incident Response

- Central logging (Elasticsearch/Grafana Loki) for investigation
- Alerting: failed login spikes, refresh-token reuse, admin anomaly, rate-limit abuse, SSRF/proxy anomalies
- Playbooks:
  1. Suspected token leak → rotate all sessions, notify user
  2. Provider key leak → rotate key, revoke URLs
  3. DB exposure → lock DB, rotate creds, audit access, notify if personal data affected
- Breach notification process per applicable law
