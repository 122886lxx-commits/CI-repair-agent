# CI Repair Agent

An agent-native control plane for repairing failed GitHub Actions runs.

This project is not a generic coding assistant. It is a bounded system that turns a CI failure into a governed workflow:

`failure context -> task spec -> repair diff -> sandbox validation -> risk gate -> draft PR -> audit trail`

## Why This Exists

Most AI coding tools can generate a patch. Very few can answer the harder production questions:

- Should this patch be allowed to run at all?
- What counts as a high-risk change?
- Was the patch validated in an isolated environment?
- Can a reviewer see why the system acted?
- Can the whole flow be rerun without losing traceability?

CI Repair Agent focuses on that governance layer.

## What It Does

- Ingests failed GitHub Actions runs
- Builds a `TaskSpec`, `TaskGraph`, and `AgentAssignment`
- Generates a bounded repair proposal with an LLM
- Validates the patch in a sandbox
- Routes risky changes into human approval
- Opens a draft PR for low-risk repairs
- Stores `ApprovalGate`, `EvalResult`, and `AuditEvent` records
- Exposes a web console for review, approval, rerun, and audit

## Product Boundaries

This v1 is intentionally narrow.

It does:

- GitHub only
- GitHub Actions only
- Single-tenant internal deployment
- Draft PR flow
- Human approval for risky changes
- Audit-first execution

It does not do:

- Auto-merge
- Direct pushes to `main`
- Multi-tenant RBAC and billing
- Provider routing across multiple model vendors
- A general-purpose agent runtime

## How It Works

The system follows an agent-native workflow with five fixed roles:

- `Orchestrator`
- `Builder`
- `Reviewer`
- `Evaluator`
- `Release Gatekeeper`

High-level execution flow:

1. Read workflow metadata and failure context.
2. Build a bounded task spec and task graph.
3. Ask the model provider for a repair diff.
4. Validate the diff in a sandbox.
5. Apply policy heuristics to detect risky surfaces.
6. Open a draft PR or stop at an approval gate.
7. Write audit events for the full run.

```mermaid
flowchart LR
  A["GitHub Actions failure"] --> B["TaskSpec + TaskGraph"]
  B --> C["Repair patch"]
  C --> D["Sandbox validation"]
  C --> E["Risk engine"]
  D --> F["Release Gate"]
  E --> F
  F -->|Low risk| G["Draft PR"]
  F -->|High risk| H["Human approval"]
  G --> I["Audit trail"]
  H --> I
```

## Architecture

- `src/app`: Next.js control plane and API routes
- `src/worker`: polling worker that advances queued jobs
- `src/server/services/job-service.ts`: main orchestration logic
- `src/server/github`: GitHub Actions, OAuth, branch push, and PR creation
- `src/server/sandbox`: repo clone, patch apply, validation planning, Docker execution
- `src/server/risk`: policy heuristics and approval triggers
- `src/server/db`: memory and PostgreSQL repositories

Core persisted objects:

- `Job`
- `TaskSpec`
- `TaskGraph`
- `AgentAssignment`
- `DiffCandidate`
- `ApprovalGate`
- `EvalResult`
- `AuditEvent`

## Modes

There are two practical runtime modes in this repo:

### Dry-run mode

Default local mode. Good for UI, API, and workflow testing.

- `AUTH_BYPASS=true`
- `LIVE_SANDBOX=false`
- GitHub service returns synthetic workflow context
- No real branch push or PR creation

### Live mode

Real GitHub + Docker execution path.

Required:

- GitHub App credentials
- GitHub OAuth credentials
- OpenAI API key
- PostgreSQL
- Docker
- `LIVE_SANDBOX=true`

In live mode, the system can:

- clone a target repository at a specific SHA
- apply a generated patch
- infer validation commands from repo scripts and lockfiles
- run install and validation in containers
- push a repair branch
- create a draft PR

## Risk Gates

The risk engine routes these surfaces into approval:

- `.github/workflows/*`
- infrastructure configuration
- auth or permission surfaces
- schema or migration files
- destructive deletes
- dependency upgrade patches
- hotfix residual-risk review

Low-risk source edits can continue automatically. High-risk changes stop at an `ApprovalGate`.

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Configure env

```bash
cp .env.example .env
```

Local development defaults:

- `AUTH_BYPASS=true`
- `LIVE_SANDBOX=false`
- `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/ci_repair_agent`

### 3. Start PostgreSQL

```bash
docker compose up -d postgres
```

### 4. Start the control plane

```bash
npm run dev
```

### 5. Start the worker

```bash
npm run dev:worker
```

Open `http://127.0.0.1:3000`.

## Verification

```bash
npm run check
npm run build
```

Current test coverage includes:

- risk-engine approval behavior
- sandbox network/install behavior
- rerun state reset and attempt increment
- API auth returning typed `401` responses

## API Surface

### Create job

```bash
curl -X POST http://127.0.0.1:3000/api/jobs \
  -H "content-type: application/json" \
  -d '{
    "repo": "acme/repo",
    "sha": "abc123def456",
    "workflow_run_id": 42,
    "mode": "fix"
  }'
```

### Main routes

- `POST /api/jobs`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/diff`
- `POST /api/jobs/:id/approve`
- `POST /api/jobs/:id/reject`
- `POST /api/jobs/:id/rerun`
- `POST /api/github/webhooks`

## Environment

See [.env.example](.env.example).

Important variables:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `DATABASE_URL`
- `LIVE_SANDBOX`
- `SANDBOX_NETWORK_DISABLED`

## Repository Status

This repo is already usable as a serious v1 skeleton:

- control plane UI
- worker loop
- PostgreSQL persistence
- GitHub App and OAuth adapters
- draft PR flow
- Docker-based sandbox validation
- approval and audit model

Still incomplete:

- richer repository-specific bootstrap detection
- more robust patch fallback and recovery policy
- broader eval datasets from real CI failures
- live observability and streaming execution logs
- production hardening beyond single-tenant internal use

## Related Docs

- [AI PM case study](docs/ai-pm-case-study.md)
- [solo-client-factory skill](solo-client-factory/SKILL.md)

## License

No license file has been added yet. Until one is added, treat this repository as all rights reserved.
