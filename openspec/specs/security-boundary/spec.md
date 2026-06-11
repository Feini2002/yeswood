# security-boundary Specification

## Purpose
TBD - created by archiving change seed-core-contract-specs. Update Purpose after archive.
## Requirements
### Requirement: Frontend never receives DingTalk secrets
The system SHALL keep DingTalk tokens, app secrets, sync keys, token provider URLs, real upstream API identifiers, and complete sensitive runtime configuration out of frontend source, browser responses, and browser requests.

#### Scenario: Static frontend contains no DingTalk secret
- **WHEN** frontend assets under `public/` are served to the browser
- **THEN** they MUST NOT contain DingTalk access tokens, AppSecret values, sync keys, token provider URLs, or real upstream API endpoints

#### Scenario: Browser API response is sanitized
- **WHEN** the browser calls a system `/api/*` endpoint
- **THEN** the response MUST NOT include DingTalk tokens, AppSecret values, full Authorization headers, or raw environment configuration

### Requirement: Backend does not expose DingTalk write APIs
The backend SHALL NOT provide API routes that create, update, delete, or batch-write DingTalk records.

#### Scenario: Local dashboard sync is read-only toward DingTalk
- **WHEN** a user triggers a sync or reads dashboard data
- **THEN** the backend MAY read DingTalk records and write local SQLite data
- **AND** it MUST NOT call a DingTalk write endpoint

#### Scenario: Future local edit remains local
- **WHEN** a future local edit endpoint changes project data
- **THEN** it MUST write only local storage and MUST NOT write back to DingTalk

### Requirement: Sync endpoints are protected and rate controlled
The system SHALL protect write-like local sync endpoints with explicit intent, same-origin or key checks, and rate/in-flight safeguards.

#### Scenario: Protected sync rejects missing intent
- **WHEN** a request attempts to trigger backend sync without the required sync key or same-origin save intent configured for that endpoint
- **THEN** the backend MUST reject the request without exposing secrets

#### Scenario: Concurrent sync does not overlap
- **WHEN** a sync operation is already in flight
- **THEN** another sync request MUST be rejected or deferred by the sync gate rather than running concurrently

### Requirement: Logs redact sensitive values
The system SHALL redact token, secret, key, and Authorization values before logging.

#### Scenario: Error metadata contains a secret-shaped value
- **WHEN** logging metadata includes a token, secret, API key, or Authorization header
- **THEN** the logged output MUST mask the sensitive value

