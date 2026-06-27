# Changes Summary

## v1.10 → v1.12

- Corrected Match-row handling: the bot no longer clicks the `Match` button.
- Match rows are queued by their row dropdown and opened by selecting the dropdown `Review` menu item.
- Updated the userscript header version to `1.12`.

## v1.9 → v1.10

- The review queue now opens rows whose action button is `Review` or `Match`.
- Rows whose only action is `Create expense` remain skipped by the queue.
- Updated the userscript header version to `1.10`.

## v1.8 → v1.9

- Added a dedicated `china_dragon_trading` payee rule.
- China Dragon Trading fills as a food supplier, then uses the form-panel `Create expense` button instead of `Save and next`.
- Updated the userscript header version to `1.9`.

## v1.7 → v1.8

- Fixed dropdown matching so payees such as `New West Foods` are not rejected as create-new options.
- Reused the dropdown option selection path for payee, bank, and category fields.
- Added clearer dropdown diagnostics when an expected option is not visible.
- Updated the userscript header version to `1.8`.

## v1.6 → v1.7

- Description filling now uses the matched rule payee name for `"fill"` decisions.
- Centralized the description value in `decide()` so rule callbacks cannot accidentally use the pre-filled QBO payee value for description text.
- Updated the userscript header version to `1.7`.

## v1.5 → v1.6

## 1. README.md (new file)

Added comprehensive `README.md` covering:
- Project title and description
- Features overview
- Prerequisites (Tampermonkey/Greasemonkey)
- Installation (raw URL + manual copy)
- Usage guide (Run, Stop, Clear State buttons)
- Configuration reference (CONFIG structure: accounts, categories, tax, payeeRules)
- Payee rules matching logic (substring match, first-match-wins, name entry types)
- Rule `apply()` callback parameters and return object reference
- Payee-to-description feature documentation
- Troubleshooting (panel not appearing, skips, form fields, position loss, tax dropdown)
- License and disclaimer

## 2. Draggable Control Panel

Replaced `addControlPanel()` with a draggable version:

- **Header bar**: Dark `#2c2c2c` bar at top of panel with text "QBO Bot" and `cursor: grab`
- **Drag implementation**: `mousedown` on header → `mousemove` on `document` → `mouseup` to release
- **Position persistence**: Saved to `localStorage` key `qbo_bot_panel_pos` as JSON `{x, y}`
- **Restore on creation**: Reads saved position; falls back to top-right (20px margin) if none
- **Viewport clamping**: `clampPos()` ensures panel stays within `window.innerWidth/Height` bounds
- **CSS**: `position: fixed`, `z-index: 999999`, `user-select: none` to prevent text selection during drag
- **Resize handler**: Re-clamps position on `window.resize` event
- **Button isolation**: Drag only starts on header mousedown; buttons in body div are unaffected
- **Structure**: Panel has two children — header (drag handle) and body (buttons container)

## 3. Payee-to-Description Feature

### Rule `apply()` callbacks
Added `description` field to all six fill-type rule callbacks:
- `consumable_supplier`: `description: payeeName`
- `food_supplier`: `description: payeeName`
- `hardware_store`: `description: "Bunnings"` (hardcoded payee)
- `maintenance_service_provider`: `description: "Aussie Filters"` (hardcoded payee)
- `supermarket_no_tax`: `description: payeeName`
- `supermarket_partial_tax`: `description: payeeName`
- `vehicle`: `description: payeeName`

### `fillForm()` function
Added description fill block after category fill, before tax fill:
- Checks `decision.description` exists and `form.fields.description` exists
- Reads existing description field value via `cleanText(descField.value)`
- If existing text present: appends with em-dash separator — `existing — payeeName`
- If empty: sets to `decision.description` directly
- Uses `setNativeValue` + `key(el, "Tab")` pattern consistent with other field fills
- Logs `[QBO Bot] Description filled: <value>` for debugging

## 4. Userscript Header Updates

- `@version`: `1.5` → `1.6`
- `@description`: Updated to mention draggable panel and payee-to-description

## Verification

- `node --check qbo-receipt-automation.js` — passes (no syntax errors)
- `README.md` exists (9.4 KB)
- Drag handle code confirmed: `PANEL_POS_KEY`, `dragOffsetX/Y`, `mousedown/mousemove/mouseup` handlers, `clampPos()`
- Description fill code confirmed: `decision.description` checks in `fillForm()`, `description` field in all 7 rule callbacks
