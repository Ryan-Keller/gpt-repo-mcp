# Portfolio execution contract

Status: implemented H1/H2 backbone as of 2026-07-16

## Purpose

`repo_portfolio_action_command` remains the stable decision boundary. A normal command only changes the portfolio ledger. A single `route` command may also include an explicit `execution` object to request one durable Hermes off-thread transaction.

## Guardrails

- The target must resolve through the approved repository registry.
- One execution request may contain exactly one action.
- Consent must be explicitly true.
- Satisfaction is constrained to 90 through 95; Field Console requests 95.
- Approval-required work must include nonempty repo-relative allowed paths.
- Read-only work may use an empty allowed-path set and must declare a read-only proof boundary.
- The installed `D:\HermesDesktop\scripts\hermes-off-thread.ps1` launcher remains the transaction owner.
- A failed, blocked, or timed-out launch does not write a routed ledger transition.

## Receipts

Successful launch returns `execution_receipts` containing a stable goal ID plus the Hermes transaction, board, task, transaction path, operator status, and satisfaction gate. Field Console persists this receipt locally and calls `repo_hermes_watch` with the exact transaction identity and returned cursor.

The UI may claim active work only when a transaction receipt exists. It may claim accepted work only when the watch surface returns terminal acceptance.

## Stop and archive

Stopping active work is a two-boundary operation:

1. `repo_hermes_cancel` must confirm cancellation of the exact transaction.
2. `repo_portfolio_action_command` records the ledger `stop` transition.

Archiving preserves history. If work is still active, cancellation must be confirmed before recording the archive transition.

## Remaining work

- Add action-specific repo-relative scopes for approved implementation actions.
- Add bounded correction and verification interventions from Field Console.
- Add a separately approved git review, commit, and push contract.
- Verify the complete path with an operator-selected real action; automated tests do not create unsolicited live Hermes transactions.
