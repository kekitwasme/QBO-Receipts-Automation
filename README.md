# QBO Receipt Automation

A Tampermonkey userscript that automates receipt review in QuickBooks Online (QBO). The script scans the receipts review queue, matches each receipt against configurable payee rules, fills in the correct account, category, tax code, and description, then clicks **Save and next** — hands-free.

## Features

- **Stable review queue** — builds a queue of all "Review" rows on the page and processes them one-by-one.
- **Payee rules engine** — match receipts by payee name (fuzzy substring), with per-rule account, category, tax, and payee overrides.
- **Auto tax calculation** — computes GST amounts automatically; skips receipts with full GST where only partial is expected.
- **Draggable control panel** — a floating panel you can reposition by dragging its header; position persists across sessions.
- **Payee-to-description** — when a payee rule matches, the matched payee name is written to the description field.
- **Run completion notification** — audible beep, on-screen toast, and desktop notification when the run finishes.
- **Stop & Clear State buttons** — halt automation or reset state at any time.

## Prerequisites

- A modern Chromium-based browser (Chrome, Edge, Brave, Arc, etc.)
- **Tampermonkey** (recommended) or **Greasemonkey** browser extension installed
- Access to a QuickBooks Online company file at `https://qbo.intuit.com/app/receipts`

## Installation

### Option A — Install via raw URL

1. Click the Tampermonkey icon in your browser toolbar → **Dashboard** → **Utilities**.
2. Paste the raw URL of this script into the "Import from URL" field:
   ```
   https://raw.githubusercontent.com/YOUR_USERNAME/QBO-Receipts-Automation/main/qbo-receipt-automation.js
   ```
3. Click **Import** → confirm the install dialog.

### Option B — Manual copy

1. Open `qbo-receipt-automation.js` in this repo and copy the entire contents.
2. Click the Tampermonkey icon → **Create a new script**.
3. Paste the copied code into the editor, replacing any default template.
4. Press **Ctrl+S** (or **⌘S**) to save.
5. Ensure the script is enabled (toggle switch in Tampermonkey dashboard).

## Usage

1. Navigate to `https://qbo.intuit.com/app/receipts` in your browser.
2. The floating **QBO Bot** panel appears in the top-right corner (drag it by its header to reposition).
3. Click **Run QBO Bot** to start processing the receipt review queue.
4. The bot will:
   - Build a queue of all rows with a **Review** button.
   - Open each receipt, read the form values, and match against payee rules.
   - Fill account, category, tax type, tax amount, and description.
   - Click **Save and next** and move to the next receipt.
5. Click **Stop** at any time to halt after the current receipt.
6. Click **Clear State** to reset the processed/skipped queues (must not be running).

### Control Panel Buttons

| Button        | Action                                                    |
|---------------|-----------------------------------------------------------|
| Run QBO Bot   | Starts the automation loop.                               |
| Stop          | Requests the bot to stop after the current receipt.       |
| Clear State   | Clears all queues, counters, and processed/skipped sets.  |

## Configuration

All configuration lives in the `CONFIG` constant near the top of the script.

### Structure

```javascript
const CONFIG = {
    autoSave: true,           // Auto-click "Save and next" after filling
    autoClearOnRun: true,     // Clear state automatically when starting a new run
    maxAmount: 800,           // Skip receipts above this dollar amount

    accounts: {
        commbank: "1101 Commbank",              // Bank account name in QBO
        supplierAP: "2001 Supplier Accounts Payable", // AP account name in QBO
    },

    categories: {
        food: "5111 Food & Beverage Costs",
        consumables: "5601 Small & Consumable Items",
        vehicle: "8500 Motor Vehicle Expenses",
        maintenance: "6701 Repairs and Maintenance",
    },

    tax: {
        gst: "GST on purchases",       // Tax code name for GST
        gstFree: "GST free purchases", // Tax code name for GST-free
    },

    payeeRules: [ /* see below */ ],
};
```

### `accounts`

Maps shorthand keys to the exact account names shown in QBO's account dropdown. These are used in payee rules to select the bank or AP account.

### `categories`

Maps shorthand keys to the exact category names shown in QBO's category dropdown.

### `tax`

Maps shorthand keys to the exact tax code names shown in QBO's tax dropdown. Used by `fillTaxType()`.

### `payeeRules`

An array of rule objects. Each rule defines which payees it matches and what fields to fill.

```javascript
{
    type: "food_supplier",       // Internal rule identifier
    names: [                      // Array of names/patterns to match
        "jun pacific",
        "perth seafoods",
        // ...
    ],
    apply: ({ amount, tax, CONFIG, payeeName, values }) => ({
        action: "fill",           // "fill" or "skip"
        type: "food_supplier",
        payee: payeeName,        // Payee name to enter
        bank: CONFIG.accounts.supplierAP,
        category: CONFIG.categories.food,
        taxType: tax ? CONFIG.tax.gst : CONFIG.tax.gstFree,
        taxAmount: tax ? undefined : "0.00",
    }),
}
```

## How Payee Rules Work

### Matching Logic

1. The bot reads the receipt form values (payee, description, memo, ref).
2. These values are concatenated into a single search string.
3. The search string is normalised (lowercased, trimmed).
4. For each rule in `CONFIG.payeeRules`, the bot iterates over `rule.names`.
5. Each name entry is compared via substring match (`searchText.includes(name)`).
6. The **first matching rule wins** — order matters.

### Name Entry Types

Each item in the `names` array can be:

- **String** — e.g. `"coles"`. Matches if the search text contains "coles". The payee name used is the string itself.
- **Object** — e.g. `{ match: "spud shed", payee: "spud shed" }`. The `match` property is used for substring matching; the `payee` property is the display name written to the payee field.

### Rule `apply()` Callback

When a rule matches, `apply()` is called with:

| Parameter   | Description                              |
|-------------|------------------------------------------|
| `amount`    | Numeric total from the receipt form      |
| `tax`       | Numeric tax amount (or `null`)           |
| `CONFIG`    | The global config object                 |
| `payeeName` | The resolved payee name for the match    |
| `matchedName` | The matched name string                |
| `values`    | All raw form values                      |

It must return a decision object:

| Property     | Required | Description                                      |
|--------------|----------|--------------------------------------------------|
| `action`     | Yes      | `"fill"` to auto-fill, `"skip"` to skip          |
| `payee`      | If fill  | Payee name to enter                              |
| `bank`       | If fill  | Account name to select                           |
| `category`   | If fill  | Category name to select                           |
| `taxType`    | If fill  | Tax code name                                    |
| `taxAmount`  | Optional | Override tax amount string                       |
| `description`| Optional | Text to write to description field (added to existing) |
| `reason`     | If skip  | Human-readable reason for skipping               |

### Payee-to-Description Feature

When a payee rule matches and the action is `"fill"`, the matched payee name is written to the description field:

- If the description field is empty, the payee name is inserted.
- If the description already has text (e.g., from QBO OCR), the payee name is appended: `existing — payeeName`

## Troubleshooting

### The panel doesn't appear

- Ensure the script is enabled in Tampermonkey.
- Check the browser console (`F12` → Console) for `[QBO Bot] Loaded.` message.
- Confirm you're on `https://qbo.intuit.com/app/receipts*`.
- Wait a few seconds for the page to fully load.

### Bot skips all receipts

- Payee names in `CONFIG.payeeRules[].names` must be **lowercase**.
- Matching is substring-based — partial names work (e.g., `"coles"` matches "Coles Supermarket").
- Check the console for `[QBO Bot] Skipped:` messages with the reason.

### Form fields not filled

- QBO's DOM structure may change. The selectors in `readForm()` use `aria-label` and `placeholder` attributes — update them if Intuit changes the UI.
- Check console warnings: `[QBO Bot] Bank field failed/missing.` etc.

### Panel position lost

- The panel position is stored in `localStorage` under key `qbo_bot_panel_pos`.
- Clearing site data will reset the position to top-right default.

### Tax dropdown not found

- The bot looks for `input[placeholder="Select tax rate"]` or any input containing "GST" in its value.
- If QBO renames this placeholder, update the selector in `fillTaxType()`.

## License

This project is released into the public domain. Use it freely.

**Disclaimer:** This userscript automates interactions with QuickBooks Online. Use at your own risk. Always review filled forms before saving, especially in production environments. The author is not affiliated with Intuit and accepts no responsibility for data entry errors.