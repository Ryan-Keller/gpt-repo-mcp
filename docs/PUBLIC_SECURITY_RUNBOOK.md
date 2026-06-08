# Public MCP Security Runbook

This runbook applies when GPT Repo MCP is reachable through a public hostname or
tunnel path such as `/t/<path-token>/mcp`.

By default, the path token is not authentication. Use an outer identity gate
such as Cloudflare Access when possible, and use the app-level token gate for
public/tunnel exposure.

ChatGPT Pro connector setups may not expose custom auth headers. For that
case, the server has an explicit compatibility mode:

```powershell
[Environment]::SetEnvironmentVariable("BRIDGE_ALLOW_PATH_TOKEN_CONNECTOR_AUTH", "1", "User")
```

When this mode is enabled, the tokenized `/t/<path-token>/mcp` route is accepted
as connector authentication. Treat the full connector URL as a secret. This is
weaker than a real auth header, but still keeps anonymous `/health` redacted and
non-tokenized sensitive endpoints such as `/tool-catalog` denied.

## Access Matrix

| Tier | Surfaces | Public behavior |
| --- | --- | --- |
| `public_safe` | unauthenticated `GET /health` | Redacted liveness only: service alive, generic status, timestamp, and `authentication_required`. |
| `authenticated_read` | `repo_list_roots`, `repo_runner_status`, `agent_runner_status`, `ready_results`, `recent_events`, `capability_summary`, `vision_capabilities`, `/tool-catalog` | Requires `BRIDGE_AUTH_TOKEN` when public/tunnel mode is enabled, unless explicit path-token connector auth compatibility mode is enabled for `/t/<path-token>/mcp`. |
| `privileged_write` | `repo_write_codex_task`, `repo_write_file`, `repo_write_changes`, `repo_write_handoff`, `repo_cleanup_paths`, `codex_run_and_wait` | Requires auth and existing repo write/operation policy. |
| `dangerous_git` | stage, unstage, restore, recover, commit tools | Requires auth, repo operation opt-in, expected HEAD/path checks, and human approval. No push exists. |
| `local_only` | runner control, raw process inspection, local model invocation, secrets/config diagnostics | Do not expose publicly. Keep on loopback/local shell only. |

Unauthenticated callers must not see repo ids, local paths, queue entries,
ready result text, run ids, event summaries, model names, PID/lock details,
hostnames, tunnel details, git state, prompt text, or secrets.

## Required App-Level Auth

Set one app-level token outside the repo:

```powershell
[Environment]::SetEnvironmentVariable("BRIDGE_AUTH_TOKEN", "<long-random-token>", "User")
```

Restart the MCP server after setting or rotating the token.

The server accepts either header:

```text
Authorization: Bearer <long-random-token>
x-bridge-auth-token: <long-random-token>
```

Use `x-bridge-auth-token` only when the connector cannot send a Bearer token.
Never commit real token values, connector URLs with private path tokens, or
Cloudflare credentials.

If public/tunnel mode is enabled and no token is configured, sensitive MCP
routes lock down and `/health` reports a public-safe locked status.

## ChatGPT Pro Headerless Connector Mode

Use this only when the connector cannot send custom headers:

```powershell
[Environment]::SetEnvironmentVariable("BRIDGE_ALLOW_PATH_TOKEN_CONNECTOR_AUTH", "1", "User")
```

Restart the MCP server after setting it. Then configure ChatGPT with only:

```text
https://mcp.example.com/t/<long-random-path-token>/mcp
```

Expected behavior:

- `repo_list_roots` succeeds from ChatGPT because the route token is accepted as
  connector auth.
- Anonymous `/health` remains redacted.
- Anonymous `/tool-catalog` still returns 401.
- Any caller with the full connector URL can reach MCP tools, so protect the
  hostname with Cloudflare Access when possible and rotate the path token if the
  URL is shared.

## Cloudflare Access

Recommended public deployment layers:

1. Put `mcp.<domain>` behind Cloudflare Tunnel.
2. Protect the hostname with Cloudflare Access or equivalent identity policy.
3. Keep the local MCP server token gate enabled with `BRIDGE_AUTH_TOKEN`.
4. Configure the ChatGPT connector to send the app-level token header if the
   chosen connector mode supports custom headers.

Cloudflare Access protects the domain. `BRIDGE_AUTH_TOKEN` protects the app if a
tunnel or DNS rule is accidentally exposed.

## Anonymous Denial Test

Anonymous health should be redacted:

```powershell
Invoke-RestMethod https://mcp.example.com/health
```

Expected shape:

```json
{
  "ok": true,
  "name": "gpt-repo-mcp",
  "alive": true,
  "status": "ok",
  "timestamp": "...",
  "authentication_required": true
}
```

Anonymous catalog/sensitive access should fail:

```powershell
Invoke-RestMethod https://mcp.example.com/tool-catalog
```

Expected: HTTP 401 when a token is configured, or HTTP 503 when public/tunnel
mode is enabled but `BRIDGE_AUTH_TOKEN` is missing.

## Authorized Success Test

Use a placeholder in docs and the real token only in your shell:

```powershell
$headers = @{ Authorization = "Bearer <long-random-token>" }
Invoke-RestMethod https://mcp.example.com/health -Headers $headers
Invoke-RestMethod https://mcp.example.com/tool-catalog -Headers $headers
```

Authorized `/health` may include `tool_catalog_hash`, `tool_count`, required
tool exposure, auth status, and connector diagnostics.

## Session-Terminated Diagnostics

When ChatGPT reports `Session terminated`, do not assume the runner failed.
Check these separately:

1. Bridge server: authorized `/health`, `started_at`, uptime, and
   `tool_catalog_hash`.
2. MCP connector/session: `connector_status`,
   `last_connector_error_kind`, `last_failed_tool_call`,
   `contract_schema_version`, and `suggested_next_action`.
3. Runner: `repo_runner_status` or local
   `python projects/agent-runner/agent_runner.py --status-plain`.
4. Worker: heartbeat freshness and worker status.
5. Queue: `queue_entries`, pending count, active locks, stale locks, and ready
   results.
6. Auth: whether the connector is sending `Authorization: Bearer` or
   `x-bridge-auth-token`.
7. Schema/cache: compare `/health` `tool_catalog_hash` with `/tool-catalog`,
   restart the MCP server, and refresh the connector cache when schemas change.

Concrete recovery order:

1. Retry a compact status call.
2. Refresh or re-open the ChatGPT connector/session.
3. Restart the MCP server and verify fresh `started_at`.
4. Run the live tools/list guard:

```powershell
.\scripts\check-gpt-repo-mcp-live-tools.ps1 -ExpectedTool repo_list_roots
```

5. Check runner status only after bridge/connector/auth are known.

## Compact Task Submission

`repo_write_codex_task` returns a compact receipt after writing task files. It
does not echo `PROMPT.md` or the input prompt body. If a connector drops after a
successful write, recover with:

```text
repo_last_write
repo_runner_status
repo_list_roots.runner_status
```

The receipt surfaces `run_id`, written paths, and queued status only. Full
prompt content remains on disk at the repo-local `PROMPT.md` path.
