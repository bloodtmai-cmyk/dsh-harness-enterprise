# @deepseek-ai/dsh-client-locale

English | [中文](README.zh.md)

Locale plugin: LocaleRuntime — the `zh`/`en` preference stored as `locale.preference` in `$DSH_HOME/settings.yaml`; when that explicit Host value is absent, a fresh browser starts provisionally in the language `navigator` asks for (primary-subtag matching, with `zh` when it asks for no language this app ships). The Host read runs after plugin activation so an unavailable settings service cannot block the page; its result replaces the provisional browser value live. Remote browsers retain only a process-local selection because the settings API is loopback-only. `locale/change` fires on switches. The service also owns the ns×locale dictionary registry (typed `register(ns, {zh, en})` checked against `LocaleNamespaceMap`, `bind(ns)`→`TranslateNS<ns>`; lookup chain ns → common → zh → key), implements the slot system's `LocaleFace`, and installs itself through `ctx.slots.installLocale`, backing the framework-injected `t` standard seat (`Translate`/`TranslateNS` are ui-slots types; import them from there — this package only re-exports for dictionary owners' convenience). The [Host-backed preferences decision](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md) owns the persistence boundary.

## Model Experience

### Managed desktop output-language guidance

#### What the model sees

When the managed desktop host sets `DSH_OUTPUT_LANGUAGE_FROM_LOCALE=1`, one instruction asks visible reasoning, plans, tool explanations, and final responses to use the latest `locale.preference`. Code, commands, identifiers, file paths, and quoted source text retain their original language. The default composition registers no model instruction.

#### Token effect

One fixed two-sentence system-prompt paragraph is present in managed desktop requests. It does not add a tool schema, tool result, or per-Turn context entry.

#### KV Cache effect

The instruction is stable while the language does not change. A hot switch changes the system prompt for the next model step, so that request cannot reuse the complete prompt prefix from before the switch.

## Known Limitations and Deferred Work

- **Some surfaces keep inline copy** — Settings rows, the sidebar, question composer, and model select use locale seats; other packages still own static text directly.
- **Registry-held text reads its translation once** — copy captured at registration time outside the slot render path (e.g. the `/model` command description in the command registry) keeps the language it was registered under until re-registration; slot-rendered copy follows switches live.
