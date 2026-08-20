# @deepseek-ai/dsh-client-ui-deliverables

English | [中文](README.zh.md)

Produced-files and clickable-reference feature owner. The Node half registers final-response guidance with the system-prompt registry; the browser half registers the deliverables row a finished turn ends with into the chat view's `conversation.chat.turnTail` hole and links matching inline-code references in the closing prose. The shipped Web patch is the only composition that loads this package. Removing its one cordis.yml entry removes the guidance, row, and prose links together.

`deliverablesDefinition` folds each Turn's successful mutation calls into engine-published `DeliverablesTurnData`; `producedForClosing` reads that data with the closing Assistant seq. The vocabulary is the mutation tools' own follow-along `locations`, never the closing prose: a produced file is listed whether or not the model remembered to name it. A mutation is recognized by render intent, not tool name — a diff card, or a generic card whose `kind` is `edit` (the shape `str_replace_editor`'s insert presents) — so a new mutation tool joins by declaring what it does. Reads, deletes, and failed calls contribute nothing; a path appears once per Turn in first-seen order. The Conversation Location index owns Turn membership, so a Turn that mutates and then ends without content text cannot spill into the next Turn's row.

`ProducedFiles` renders the row between the closing message's body and its IconActions footer: a quiet label and one measured file lane. It shows the largest leading prefix that fits (up to six chips; basename text, full path as the `title`) while reserving the exact localized `+ N files` width, so the remainder stays visible without wrapping or horizontal scrolling. Each chip opens through the owner-supplied `openFile` — the same Host opener the tool rows use, with the chat view resolving relative paths against the session cwd. A right click opens that file's parent folder; the visible **Show in folder** action opens the first listed file's parent folder. Native actions appear only while the page is loopback and the current Host handshake reports `canOpenPath`; direct remote Web and headless/container Linux Hosts omit them by default. Design rationale: the [workspace file links Agent Note](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.md).

The closing prose carries the same vocabulary. This plugin provides the `chatFileMentions` service the chat view consults per closing message: `producedFileMentions` resolves an inline-code token by exact path, or by being exactly the basename of exactly one produced path — a basename two paths share stays inert rather than guessing, so a mention link can never open the wrong file or 404. A resolved mention keeps its code chip and takes the markdown sheet's link language — link-blue at rest, underlined on hover, exactly like URL-promoted inline code — with the full path as its `title`; mentions never render inside anchors or streaming text. Decision record: the [inline file mentions Agent Note](../../../.agents/notes/implemented/feature/2026-08-07-web-inline-file-mentions.md).

The Node half registers the static `ui:deliverable-file-references` system-prompt section. It makes delivery part of completing every file-processing task: after any tool successfully creates, modifies, converts, or exports a user-facing file, the model must call `deliver_files` in the same Turn with all final outputs, without waiting for a follow-up request. Temporary and intermediate files stay out of the registration, and the model cannot claim that a file is attached or downloadable before the call succeeds. The closing response names every delivered file as Markdown inline code, using the exact registered path or a basename only when unique within the Turn. Explicit registration joins the mutation-location vocabulary without scraping prose or command output. Office work must use a provisioned document tool rather than installing document-processing dependencies during a user turn; when none is available, the model reports the missing capability instead of launching an installer.

## Model Experience

### Clickable file-reference guidance

#### What the model sees

One fixed paragraph instructs the model to register every final user-facing file in the same Turn, then name each delivered file as exact-path or unique-basename Markdown inline code, such as `out/report.html`.

#### Token effect

One fixed prompt paragraph whenever this package is loaded; no tool schema, tool result, or per-Turn context is added.

#### KV Cache effect

The section is static at order 190 for the lifetime of the package mount, so it remains in the reusable prompt prefix and does not change across Turns.

## Known Limitations and Deferred Work

- **Mention matching is exact path or unique basename only.** A suffix mention (`out/index.html` written as `index.html` resolves; `deep/out/index.html` written as `out/index.html` does not) stays inert; widening the matcher is deferred until a real closing-message shape needs it.
- **Delivery remains explicit and verified.** The system does not scrape prose or command output for paths; the model must call `deliver_files` for every final user-facing output, and the call validates that each path is an existing workspace file.
- **Native folder handoff targets the Host desktop.** A browser reached through a non-loopback authority omits the action, as does a deployment reporting no native opener. SSH forwarding that makes a remote Host look loopback-local must set the gateway's `nativeOpen: false`; so must a headless macOS/Windows Host, a WSL deployment without working Windows interop, or any Linux desktop whose display/opener probe is a false positive. Identifying the operator-visible desktop remains deployment policy.
