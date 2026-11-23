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
- When an update is out, the extension icon shows **NEW**: open the popup and click **Update now**.

## For the maintainer
- **Share taught buttons:** teach them under **Advanced** in the popup on the real page, click **Share with everyone** (writes `mappings.json`), then push. Users get them with the update; anyone who taught their own keeps theirs.
- **Ship an update:** change the code, **raise `version` in `manifest.json`**, and push to `main`.
