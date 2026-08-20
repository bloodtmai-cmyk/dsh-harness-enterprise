# Enterprise Account Settings

English | [中文](README.zh.md)

`@deepseek-ai/dsh-client-ui-settings-account` contributes a desktop-only **Profile** section to System Settings when the context-isolated preload exposes the narrow enterprise-account bridge. It displays the signed-in workcode, authentication method, session expiry, and optional directory attributes that were present in the verified WorkBuddy access token. Missing optional attributes are omitted instead of inferred.

The section includes an inline-confirmed sign-out action. Electron revokes the Token Broker's current session on a best-effort basis, restarts the application, and returns to the managed login page. The renderer never receives access tokens, refresh tokens, the LDAP password, the LiteLLM key, or filesystem paths.

## Model Experience

### Settings contribution

#### What the model sees

Nothing. This package renders sanitized session identity through IPC and does not add prompt content or tools.

#### Token effect

None. The browser contribution does not assemble or send provider requests.

#### KV Cache effect

None. Viewing the profile or signing out does not change a model request.

## Known Limitations and Deferred Work

- **Desktop only** - the section is absent when the Electron preload bridge is unavailable.
- **Provider claims** - name, department, job title, email, and phone appear only after the configured authentication Provider includes them in the signed access token.
