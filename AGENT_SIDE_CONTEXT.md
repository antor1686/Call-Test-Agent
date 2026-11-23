# Context for Claude: adapt "Call Test Agent" for the AGENT side

> **How to use this file:** put this whole folder somewhere on your computer, open Claude Code (or Claude) in it, and say:
> *"Read AGENT_SIDE_CONTEXT.md and all files in this folder. Help me make the agent-side version. I'll give you screenshots and evidence."*
> Then follow Claude's questions and give it the evidence listed in section 5.

---

## 1. The task we are automating

We do paired test calls in a web tool. Two people work on each item at the same time:

- **Customer**: opens the item, sees a list of available agents and clicks **Call**.
- **Agent**: receives the call on their own page (this is the side that needs a new version).

During the call, each item has a **reference sequence of tool calls**, e.g. `1 sign_in (Customer)` → `2 inspect_portal (Agent)` → `3 remove_date_override (Customer)`. These show as **step cards** in a row. The current step's card is **highlighted** (light-blue background, blue border). When it's your step, a full-width blue button **`Run <tool_name>`** shows below the card, with prefilled arguments, and you click it. Then the highlight moves to the next step. Some items have **"No customer steps"**, which means every step belongs to the agent.

When all steps are done, no card is highlighted. Then:

1. The call is ended with a red round **End call** button (phone icon, next to a grey mic button).
2. The recording uploads for a few seconds. Call status shows "Collecting the agent's local lossless recording…" / "Sending the agent recording: X of Y MB".
3. When done, call status says **"Conversation saved and ready for transcription"**.
4. The **status dropdown at the top right** of the page (shows e.g. `CustomerInCall`) is opened, and its only option (`StartTranscription → ReadyForTranscription`) is clicked. This moves to the **next item**, and everything starts again.

The red banner on the page says not to close the tab until the audio upload is complete. Automation must never skip or rush the upload.

## 2. What the existing extension does (customer side, working)

This is a Chrome Manifest V3 extension loaded via `chrome://extensions` → Developer mode → **Load unpacked**.

| File | Role |
|---|---|
| `manifest.json` | Permissions (`scripting`, `storage`, `activeTab`, `alarms`, host `<all_urls>`). Hotkeys: **Alt+Q** = next step, **Alt+W** = auto mode on/off. |
| `lib.js` | Injected into **every frame** before each action. It defines `window.HV`: page scanning, element finding, synthetic clicking, teach-mode recording, toast and status-bar UI. |
| `background.js` | Service worker. `look()` scans all frames and summarizes the state. `nextStep()` is the manual one-step-per-press logic. `tick()` is the auto-mode loop (every 1 s, with a `phase` state machine). It also handles teach mode. |
| `popup.html/js` | Start/stop auto, teach buttons, text settings, and **"Test: what do you see?"**, which prints what `HV.scan` finds in each frame (the main debugging tool). |

**Key design points (keep them):**
- **No fixed coordinates.** Elements are found every time by text, role or learned descriptor, so moving buttons don't matter.
- **`HV.scan(cfg, taught)`** returns, per frame: `run` (label of an enabled `Run …` button), `call` ({enabled}), `progress` (from text "Overall X of Y done"), `steps` ({count, active}: step cards whose last text line is exactly `Customer` or `Agent`, and how many are highlighted blue), `endCall`, `uploading`, `ready`, `dropdown`, `optionVisible`, `noCustomerSteps`.
- **"All done"** = `progress.done >= progress.total` OR (step cards exist AND none highlighted). Auto mode requires that to hold **3 ticks in a row** before ending the call.
- **Zero-step calls** (no tool steps at all, `scan.zeroSteps`: text "0 total", or "no steps" text with no step cards and no Run button): auto mode ends the call once it has lasted `noStepSeconds` (popup setting, default 10; also used for "No customer steps" items, since the agent's progress isn't visible to the customer), counted from when the End call button first appeared.
- **Teach mode** (popup): the user clicks the real element once, and `HV.arm()` records a descriptor (tag, text, aria-label, title, data-testid, id, stable classes, CSS path). `findTaught()` scores candidates to find it again. Slots: `dropdown`, `option`, `endcall`. Stored in `chrome.storage.local.taught`.
- **Clicks** are synthetic (`pointerdown/mousedown/pointerup/mouseup/click`). If a site ignores them, the fallback would be `chrome.debugger` + `Input.dispatchMouseEvent`, which gives real clicks but shows a "being debugged" bar. This isn't implemented yet.
- **Safety guards in auto mode:** the status change happens only once per item (phase `advanced`). The extension never clicks Call while ending or uploading. It stops with a red message if End call or the dropdown can't be found. A double-press cooldown applies in manual mode.

**Customer auto-mode phases:** `start` → click Call → `calling` → (agent picks up) `inCall` → click my `Run …` buttons when they appear → all done → End call → `ended` → wait for upload → `ready` → status change → `advanced` → wait for the next item's Call button → repeat.

## 3. What is likely different on the AGENT side (must be confirmed with evidence)

Don't assume these. Confirm each one from screenshots or HTML:

1. **Receiving the call:** instead of a `Call` button there is probably an incoming-call prompt (`Accept` / `Answer` / `Join` / a green button?). Find its exact text or markup, whether it appears in a popup or modal or iframe, and whether it plays a sound or shows a browser notification.
2. **Run buttons:** the agent's buttons may also say `Run <tool>`, or something else. The agent's steps are labelled `Agent` on the cards.
3. **Who ends the call:** does the agent have the red End call button too, or only the customer? If both, decide who should press it. Usually only one side should, to avoid a race.
4. **Upload:** the agent page may show different text, e.g. it is the side *sending* the "agent recording". Find the exact "uploading" and "finished" texts on the agent page.
5. **Status dropdown:** the agent's item status names and option names differ (not `CustomerInCall` / `StartTranscription`). Check whether the agent changes status at all, and what moves the agent to the next item.
6. **Availability:** the agent may need to be "available" or "Online" to receive calls (the customer sees "available · 0 waiting"). Check whether there's a toggle the automation must keep on.
7. **Frames:** check whether the workspace is inside an iframe (likely). The extension already injects into all frames.

## 4. Suggested approach for the agent version

- Copy this folder to `call-test-agent-side`. Change `name` in `manifest.json` so both can be installed side by side, and change the hotkeys if one person runs both.
- In `lib.js`: add an `acceptBtn` finder, e.g. a new `cfg.acceptTexts` setting plus a teach slot `accept`. Keep `runBtn` and `stepCards` unless the evidence says otherwise.
- In `background.js`: replace the "click Call" branch with "click Accept when the incoming call shows". Phases for the agent: `start` → wait for incoming call → accept → `inCall` → run my `Agent` steps → (End call only if the agent is responsible) → upload → status change (only if the agent does one) → `advanced` → wait for the next call.
- Update `DEFAULTS` (in both `background.js` and `popup.js`) with the agent-side texts, and add teach buttons in the popup for any new slot.
- Test with a **mock HTML page** that copies the agent UI and simulates the customer (served by `py -m http.server`), with stubbed `chrome.*` APIs so that `background.js` `tick()` can run inside the page. That's how the customer version was tested: it ran 4 full items by itself.

## 5. Evidence the agent should give Claude

Take these from the **agent's** page, at each stage of one full item:

1. **Screenshots** of:
   - idle / waiting for a call
   - the incoming call
   - in the call on a customer step
   - the agent's own step (Run button visible)
   - all steps done (no card highlighted)
   - the End call button (if any)
   - uploading
   - "saved / ready"
   - the top-right status dropdown opened
   - the next item loaded
2. **Element HTML.** Right-click the element → **Inspect** → right-click the highlighted line → **Copy → Copy outerHTML**. Do this for:
   - the Accept/Answer button
   - a `Run …` button
   - one step card (highlighted and not highlighted)
   - the End call button
   - the status dropdown and its option
3. **"Test: what do you see?" output** from this extension's popup, taken at the stages above. It shows what each frame contains, even before any agent changes.
4. **Exact texts** of the call-status messages: waiting, incoming, connected, uploading, saved.
5. **Who does what at the end:** who ends the call, and whether the agent also changes status or just waits for the next call.

Remove or blur personal data (emails, names, PINs) in screenshots if they're being shared outside the team. The extension itself never needs them.

## 6. Rules for the automation (both sides)

- It only clicks what the person would click themselves. It never types credentials, and it uses the prefilled arguments as they are.
- It never ends a call before all steps are done, and never changes status before the upload says it's finished.
- It stops and shows a red message when unsure, instead of guessing.
- Auto mode is started and stopped by the person (hotkey or popup). Watch the first few items after any change.
