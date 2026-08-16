# Safety

Computer use can affect apps and system state outside the project workspace. Treat it as a high-trust local capability.

## Default Rules

- Keep the target app and task narrow.
- Observe before every state-changing action.
- Re-observe after every state-changing action.
- Prefer structured app integrations, APIs, or file inspection when available.
- Prefer UI Automation element actions over coordinate clicks when stable element ids are available.
- Stop if the active window is not the intended window.
- For sensitive or multi-window apps, target by `nativeWindowHandle`, `processId`, or `windowTitle` instead of relying only on foreground focus.

## Ask Before Continuing

Ask the user before:

- purchases, payments, orders, subscriptions, or financial transfers
- account, security, privacy, credential, recovery, or admin settings
- sending messages, emails, posts, files, or personal data
- deleting, overwriting, submitting, signing, or publishing
- accepting terms on behalf of the user outside routine cookie banners
- actions that are hard to reverse

## Do Not Automate

Do not automate:

- Codex itself
- terminal approval prompts
- administrator authentication
- Windows UAC or security prompts
- password managers or secret reveal dialogs
- bypassing Codex sandbox or approval policy

## Sensitive Data

Screenshots, accessibility trees, visible app content, and clipboard state can contain sensitive information. Keep observations scoped and avoid opening sensitive apps unless required for the task and approved by the user.

When testing mail, chat, password, account, or document apps, avoid returning message bodies or private content unless the user explicitly asks for that content. Prefer reporting structural evidence such as window class, node counts, control roles, and successful tool results.

## Browser Use

If a browser is involved, sites may treat clicks and form submissions as coming from the signed-in user. Prefer the Codex Browser or Chrome plugin for web tasks when those tools are sufficient. Use this plugin when the workflow depends on native Windows UI or a browser state that cannot be reached another way.
