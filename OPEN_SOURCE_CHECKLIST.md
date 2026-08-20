# Community Release Checklist

- [x] Community branch uses generic product names, visuals, examples, service endpoints, and employee identifiers.
- [x] Standard Harness retains third-party provider and API-key configuration.
- [x] Managed desktop accepts model provider metadata, gateway URL, and API key only from AI Hub.
- [x] Added a tracked-worktree sanitization gate.
- [x] Public namespace is `bloodtmai-cmyk/dsh-harness-enterprise`; the maintainer is `clanie` and the private security contact is `bloodtmai@gmail.com`.
- [x] Dependency notices are verified in CI; the final lockfile is scanned before publication.
- [x] Enterprise-specific example artifacts and internal screenshots are excluded from this repository.
- [x] Binary signing and clean-machine installer validation are not applicable because the public repository publishes source only.
- [x] Public history is created from the reviewed index in a new repository and does not include the internal Git history.

A clean working tree is not evidence that the internal Git history is safe to publish. Do not push the existing internal history to a public remote without a dedicated history review.
