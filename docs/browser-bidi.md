# Experimental Firefox-family Browser Use

This unreleased backend implements the optional browser lane requested in #56. It is separate from the Gecko desktop accessibility fix. Chrome and Edge retain their CDP backend. The default browser choice still falls back to Chrome/Edge when the Windows default is another engine; Firefox is an explicit opt-in.

## Automatic isolated launch

In Computer Use settings select **Firefox family (experimental)** and turn **Show browser window** off. Equivalently set `WCU_BROWSER_APP=firefox` and `WCU_BROWSER_HEADLESS=1`. Use `WCU_BROWSER_EXE` for a particular Firefox-family executable. Engine discovery reads the Firefox App.ID in `application.ini` and registered App Paths; it does not require the executable or reported `browserName` to be `firefox`.

The backend creates its own profile under `WCU_BROWSER_PROFILE` (by default the plugin's agent-browser directory). It never opens the user's normal Firefox profile. `WCU_BROWSER_SIGNIN=1` keeps a separate profile keyed by executable; normal shutdown asks Firefox to flush cookies. One process owns that profile. Concurrent use fails with `BROWSER_PROFILE_BUSY`, rather than sharing an unsupported second BiDi session. A crashed owner can leave a browser/lock requiring manual inspection; there is no crash-recovery broker yet. Automatic visible launch is explicitly rejected, rather than silently changing a visible request into headless mode.

## Connect a separately started endpoint

Start Firefox with a **dedicated automation profile** and `--remote-debugging-port 9222`, then set `WCU_BROWSER_BIDI_URL=ws://127.0.0.1:9222/session` in the MCP server environment. The URL must be a loopback WebSocket endpoint. This explicit URL selects BiDi without requiring the browser selector. Do not point it at your normal daily profile.

The lane creates one session and discovers existing tabs through `list_windows`. A second controller is rejected while that session is active. If session creation fails because another controller owns it, this backend does not end the other's session. On normal shutdown it ends only its own session; it does not close the externally supplied browser or its tabs. Reconnect obtains new element/tab IDs. Visible externally supplied windows have not been validated for focus preservation.

## Supported workflow and limits

Use the same tools: `set_value` on `new-tab` opens a URL; `list_windows` lists tab IDs; `accessibility_tree`/`snapshot` with `browserTab` returns a DOM outline; use its IDs for click, input, focus, field values and inspection. Navigation invalidates previous element IDs. Alerts, confirms and prompts are reported and can be answered with Enter/Escape and prompt text. Screenshot dimensions describe the actual PNG.

The outline is based on DOM heuristics, not a native accessibility tree. Iframe contents, shadow DOM, canvas hit testing, file upload/download handling, blue status indicators, cross-MCP session sharing and automatic crash recovery are not implemented. Screenshots currently retain viewport size even if `maxWidth` is smaller; the result states this limitation. Scrolling uses DOM scrolling; Firefox 158's headless native wheel was observed to report success without changing scroll position. Do not interpret dispatched input as task success: inspect the resulting page.

The shipped tests cover a real Firefox 158 headless local fixture and a separately managed headless endpoint. Other Firefox forks, older ESR releases and visible endpoint focus behavior still need testing. Successful cookie persistence is not evidence that an interactive login flow has been tested.

## Tests

```text
node test/browser-bidi.mjs
node test/browser-bidi.mjs --live
```

Use `WCU_TEST_OUTPUT` for isolated test artifacts. Tests use local pages and their own profiles. Set `WCU_BROWSER_EXE` when Firefox is not installed at a registered/discoverable location.
