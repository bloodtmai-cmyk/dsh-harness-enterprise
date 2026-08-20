# Security Policy

Do not disclose exploitable vulnerabilities, credentials, internal endpoints, employee identifiers, or production data in public issues. Send reports to [bloodtmai@gmail.com](mailto:bloodtmai@gmail.com). You may also use GitHub private vulnerability reporting when it is enabled for the repository.

Reports should include the affected version, deployment mode, reproduction conditions, expected impact, and sanitized diagnostics.

The maintainer will acknowledge a report within seven calendar days. A remediation timeline depends on severity, reproducibility, and whether the issue belongs to this repository or an upstream dependency.

Managed deployments must preserve these invariants:

- Enterprise identity comes only from a verified Gateway token.
- Model provider metadata, gateway URL, and API key are issued together by AI Hub; managed users cannot override them locally.
- Secrets never enter Renderer state, ordinary settings documents, command-line arguments, or logs.
- MCP authorization is enforced during both `tools/list` and `tools/call`.
- The Electron local Web runtime requires a per-run bearer token and is not a browser-facing service.
- Managed artifacts are integrity-checked and fail closed on invalid paths, manifests, or signatures.
