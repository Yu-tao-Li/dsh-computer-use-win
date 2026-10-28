# Experimental Firefox-family Browser Use

This experimental backend implements the optional browser lane requested in #56. It is separate from the Gecko desktop accessibility fix. Chrome and Edge retain their CDP backend. The default browser choice still falls back to Chrome/Edge when the Windows default is another engine; Firefox is an explicit opt-in.

## Automatic isolated launch

In Computer Use settings select **Firefox family (experimental)**, or set `WCU_BROWSER_APP=firefox`. The Firefox that the plugin starts always runs headless: the settings page turns **Show the browser window** off while Firefox is selected, and `health` and `list_windows` report `visible: false`. Use `WCU_BROWSER_EXE` for a particular Firefox-family executable.

Discovery tries the Windows default browser first when its ProgId is a Firefox one (`FirefoxURL-…`), so a fork set as the default, such as Vantage, wins over a plain Firefox installed beside it. Then it reads the registered App Paths. Each candidate must carry the Firefox App.ID in its `application.ini`; neither the executable name nor the reported `browserName` has to be `firefox`. Registry output is decoded in the OEM code page, so browsers installed under Chinese or other non-ASCII folders are found.

The backend creates its own profile under `WCU_BROWSER_PROFILE` (by default the plugin's agent-browser directory). It never opens the user's normal Firefox profile. `WCU_BROWSER_SIGNIN=1` keeps a separate profile keyed by executable; normal shutdown asks Firefox to flush cookies. One process owns that profile through its `dsh-bidi-owner` file, which holds the owner's process id. While that process runs, another server gets `BROWSER_PROFILE_BUSY` instead of an unsupported second BiDi session. When the owner crashed or was killed, the next launch finds its process gone and takes the profile over.

## Connect a separately started endpoint

Start Firefox with a **dedicated automation profile** and `--remote-debugging-port 9222`, then set `WCU_BROWSER_BIDI_URL=ws://127.0.0.1:9222/session` in the MCP server environment. The URL must be a loopback WebSocket endpoint. This explicit URL selects BiDi without requiring the browser selector. Do not point it at your normal daily profile.

The lane creates one session and discovers existing tabs through `list_windows`. A second controller is rejected while that session is active. If session creation fails because another controller owns it, this backend does not end the other's session. On normal shutdown it ends only its own session; it does not close the externally supplied browser or its tabs. Reconnect obtains new element/tab IDs. Visible externally supplied windows have not been validated for focus preservation.

## Supported workflow and limits

Use the same tools: `set_value` on `new-tab` opens a URL; `list_windows` lists tab IDs; `accessibility_tree`/`snapshot` with `browserTab` returns a DOM outline; use its IDs for click, input, focus, field values and inspection. Navigation invalidates previous element IDs. Alerts, confirms and prompts are reported and can be answered with Enter/Escape and prompt text. Screenshot dimensions describe the actual PNG.

The outline is based on DOM heuristics, not a native accessibility tree. Links, buttons, headings, cells and paragraphs are named by their text; lists, rows, tables and other containers only by text that no listed element inside them shows, so each text appears once. Tab ids carry 64 random bits, as in the Chromium lane. Iframe contents, closed shadow roots, canvas hit testing, file upload/download handling, blue status indicators, cross-MCP session sharing and automatic crash recovery are not implemented. Screenshots currently retain viewport size even if `maxWidth` is smaller; the result states this limitation. Scrolling uses DOM scrolling; Firefox 158's headless native wheel was observed to report success without changing scroll position. Do not interpret dispatched input as task success: inspect the resulting page.

The shipped tests cover a real Firefox 158 headless local fixture and a separately managed headless endpoint. Other Firefox forks, older ESR releases and visible endpoint focus behavior still need testing. Successful cookie persistence is not evidence that an interactive login flow has been tested.

## Tests

```text
node test/browser-bidi.mjs
node test/browser-bidi.mjs --live
```

Use `WCU_TEST_OUTPUT` for isolated test artifacts. Tests use local pages and their own profiles. Set `WCU_BROWSER_EXE` when Firefox is not installed at a registered/discoverable location.
