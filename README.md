# Call Test Agent

Chrome extension for the paired call test: one hotkey does the next step (Call → your Run steps → End call → status change), or auto mode does the whole loop.

## Install (first time, Windows)
1. Press **Win + R**, paste this line and press Enter:
   ```
   powershell -ExecutionPolicy Bypass -c "iwr -useb https://raw.githubusercontent.com/antor1686/Call-Test-Agent/main/setup.ps1 | iex"
   ```
2. A window downloads the extension and opens Chrome's extensions page. Turn on **Developer mode**, click **Load unpacked**, paste the folder path (it's already copied) and press Enter.
3. The window detects it and finishes by itself. Done: updates are now one click.

Already have the extension? Open its popup and click **Turn on one-click updates** (it copies the same command; it finds your install by itself).

## Use
- **Alt+Q**: do the next step. **Alt+W**: start / stop auto mode.
- Buttons are already mapped for everyone. If one isn't found, teach it under **Advanced** in the popup.
- Calls where you have no steps end automatically after the seconds set in the popup (default 10).
- If a call fails and its audio can't be saved, it ends it without saving, discards the audio, returns to calls and calls again.
- **Key Mapper link:** paste your agent's topic into **Key Mapper topic** in the popup. The extension then posts your current item name to `https://ntfy.sh/<topic>`, so the agent's [Key Mapper](https://github.com/emransm877/Key-Mapper) can switch to the same item when it's idle. Leave it empty to turn this off.
- When an update is out, the extension icon shows **NEW**: open the popup and click **Update now**.

## For the maintainer
- **Share taught buttons:** teach them under **Advanced** in the popup on the real page, click **Share with everyone** (writes `mappings.json`), then push. Users get them with the update; anyone who taught their own keeps theirs.
- **Ship an update:** change the code, **raise `version` in `manifest.json`**, and push to `main`.

## Optional Key Mapper link

The Key Mapper topic is off when empty. With a shared random topic configured, the read-only item detector sends heartbeats to the extension background worker. Successful broadcasts are renewed once a minute; HTTP failures retry on the next three-second heartbeat, and changing the topic republishes the current item. Only the item name/company and a timestamp are sent, never call audio. Anyone knowing the topic can read it; do not reuse a public topic.

The matching Key Mapper 2.0.1 accepts only broadcasts received by ntfy within two minutes, based on the server timestamp. Closing the caller page therefore expires its current-item broadcast. This integration remains a proposed upstream change until the maintainer merges PR #1.

Run `node --test tests/itemcast.test.cjs tests/native-host.test.cjs` for synthetic relay retry and native framing regressions. The native messaging test requires Windows. No real paired call or live dropdown was validated by these tests.

The current one-click updater still downloads `antor1686/Call-Test-Agent` main. Installing this fork branch does not redirect your updater: until upstream merges the integration, clicking Update may replace it with upstream code. Develop from a separate unpacked checkout and reload it directly when testing the unmerged branch.

Keep one active caller work tab per topic. Different caller tabs can otherwise publish competing current items to the same relay topic.
