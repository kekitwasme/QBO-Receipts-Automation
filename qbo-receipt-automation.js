// ==UserScript==
// @name         QBO Receipt Automation - Stable Queue
// @namespace    qbo-receipt-automation
// @version      1.6
// @description  QBO receipt automation with stable review queue, payee aliases, auto-clear state, draggable control panel, payee-to-description, and run completion notification
// @match        https://qbo.intuit.com/app/receipts*
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    if (window.__QBO_RECEIPT_AUTOMATION_LOADED__) return;
    window.__QBO_RECEIPT_AUTOMATION_LOADED__ = true;

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const CONFIG = {
        autoSave: true,
        autoClearOnRun: true,
        maxAmount: 800,

        accounts: {
            commbank: "1101 Commbank",
            supplierAP: "2001 Supplier Accounts Payable",
        },

        categories: {
            food: "5111 Food & Beverage Costs",
            consumables: "5601 Small & Consumable Items",
            vehicle: "8500 Motor Vehicle Expenses",
            maintenance: "6701 Repairs and Maintenance",
        },

        tax: {
            gst: "GST on purchases",
            gstFree: "GST free purchases",
        },

        payeeRules: [
            {
                type: "consumable_supplier",
                names: [
                    "australian award packaging",
                    "host",
                ],
                apply: ({ amount, CONFIG, payeeName }) => ({
                    action: "fill",
                    type: "consumable_supplier",
                    payee: payeeName,
                    description: payeeName,
                    bank: CONFIG.accounts.supplierAP,
                    category: CONFIG.categories.consumables,
                    taxType: CONFIG.tax.gst,
                    taxAmount: (amount / 11).toFixed(2),
                }),
            },

            {
                type: "food_supplier",
                names: [
                    "jun pacific",
                    "perth seafoods",
                    "ntc wismettac australia",
                    "jfc australia",
                    "new west foods",
                    "new west foods wa",
                    "neighbours meat",
                    "nippon food supplies",
                    "china dragon trading",
                    "hydration hub",
                    "nice 'n' fresh",
                    "sparks coffee roasters",
                    "daiwa food",
                    "damerc",
                ],
                apply: ({ tax, CONFIG, payeeName }) => ({
                    action: "fill",
                    type: "food_supplier",
                    payee: payeeName,
                    description: payeeName,
                    bank: CONFIG.accounts.supplierAP,
                    category: CONFIG.categories.food,
                    taxType: tax ? CONFIG.tax.gst : CONFIG.tax.gstFree,
                    taxAmount: tax ? undefined : "0.00",
                }),
            },

            {
                type: "hardware_store",
                names: ["bunnings"],
                payee: "Bunnings",
                apply: ({ amount, tax, CONFIG }) => ({
                    action: "fill",
                    type: "hardware_store",
                    description: "Bunnings",
                    bank: CONFIG.accounts.commbank,
                    category: CONFIG.categories.maintenance,
                    taxType: CONFIG.tax.gst,
                    taxAmount: tax ? undefined : (amount / 11).toFixed(2),
                }),
            },

            {
                type: "maintenance_service_provider",
                names: ["aussie filters"],
                payee: "Aussie Filters",
                apply: ({ amount, tax, CONFIG }) => ({
                    action: "fill",
                    type: "maintenance_service_provider",
                    description: "Aussie Filters",
                    bank: CONFIG.accounts.supplierAP,
                    category: CONFIG.categories.maintenance,
                    taxType: CONFIG.tax.gst,
                    taxAmount: tax ? undefined : (amount / 11).toFixed(2),
                }),
            },

            {
                type: "supermarket",
                names: [
                    "coles",
                    "woolworths",
                    "aldi",
                    { match: "spud shed", payee: "spud shed" },
                    { match: "spudshed", payee: "spud shed" },
                    "iga",
                    "costco",
                    "np",
                    "tony ale",
                    "central oriental",
                    "cockburn oriental",
                    "scutti",
                    "market",
                    "fresh",
                    "oriental",
                ],
                apply: ({ amount, tax, CONFIG, payeeName }) => {
                    if (!tax) {
                        return {
                            action: "fill",
                            type: "supermarket_no_tax",
                            payee: payeeName,
                            description: payeeName,
                            bank: CONFIG.accounts.commbank,
                            category: CONFIG.categories.food,
                            taxType: CONFIG.tax.gstFree,
                            taxAmount: "0.00",
                        };
                    }

                    const expectedGst = amount / 11;

                    if (tax >= expectedGst - 0.02) {
                        return {
                            action: "skip",
                            reason: "full GST detected for supermarket",
                            amount,
                            tax,
                            expectedGst,
                        };
                    }

                    return {
                        action: "fill",
                        type: "supermarket_partial_tax",
                        payee: payeeName,
                        description: payeeName,
                        bank: CONFIG.accounts.commbank,
                        category: CONFIG.categories.food,
                        taxType: CONFIG.tax.gst,
                    };
                },
            },

            {
                type: "vehicle",
                names: [
                    "fuel",
                    "atlas fuel",
                    "vibe petroleum",
                    "thomile",
                    "ampol",
                    "caltex",
                    "bp",
                    "shell",
                    "7-eleven",
                    "mechanic",
                    "tyre",
                    "automotive",
                    "workshop",
                    "eg",
                    "egeg",
                ],
                apply: ({ amount, tax, CONFIG, payeeName }) => ({
                    action: "fill",
                    type: "vehicle",
                    payee: payeeName,
                    description: payeeName,
                    bank: CONFIG.accounts.commbank,
                    category: CONFIG.categories.vehicle,
                    taxType: CONFIG.tax.gst,
                    taxAmount: tax ? undefined : (amount / 11).toFixed(2),
                }),
            },
        ],
    };

    const STATE = {
        running: false,
        reviewQueue: [],
        reviewIndex: 0,
        skippedRowKeys: new Set(),
        processedRowKeys: new Set(),
        currentRowKey: null,
        processed: 0,
        skipped: 0,
        failed: 0,
    };

    function clearState() {
        STATE.reviewQueue = [];
        STATE.reviewIndex = 0;
        STATE.skippedRowKeys.clear();
        STATE.processedRowKeys.clear();
        STATE.currentRowKey = null;
        STATE.processed = 0;
        STATE.skipped = 0;
        STATE.failed = 0;
        console.warn("[QBO Bot] State fully cleared.");
    }

    function cleanText(v) {
        return String(v || "").replace(/\s+/g, " ").trim();
    }

    function normalise(v) {
        return cleanText(v).toLowerCase();
    }

    function getRuleNameValue(item) {
        return typeof item === "string" ? item : item.match;
    }

    function getRulePayeeValue(item) {
        return typeof item === "string" ? item : item.payee;
    }

    function isVisible(el) {
        if (!el) return false;

        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            style.opacity !== "0"
        );
    }

    function getRowKeyFromRow(row) {
        return [...row.querySelectorAll("td")]
            .map(td => cleanText(td.innerText))
            .join(" | ");
    }

    function getReviewButtonFromRow(row) {
        return [...row.querySelectorAll("button")]
            .find(b => cleanText(b.innerText) === "Review" && isVisible(b));
    }

    function getLiveReviewRows() {
        return [...document.querySelectorAll("table tr")]
            .map(row => {
                const reviewButton = getReviewButtonFromRow(row);
                if (!reviewButton) return null;

                return {
                    row,
                    reviewButton,
                    key: getRowKeyFromRow(row),
                    top: row.getBoundingClientRect().top,
                };
            })
            .filter(item => item && item.key)
            .sort((a, b) => a.top - b.top);
    }

    function buildReviewQueue() {
        STATE.reviewQueue = getLiveReviewRows().map(item => ({
            key: item.key,
            text: cleanText(item.row.innerText),
        }));

        STATE.reviewIndex = 0;
        console.table(STATE.reviewQueue.map((item, i) => ({
            index: i + 1,
            key: item.key,
        })));
    }

    function findCurrentRowByKey(keyValue) {
        return getLiveReviewRows().find(item => item.key === keyValue);
    }

    function getNextReviewRow() {
        if (!STATE.reviewQueue.length) buildReviewQueue();

        while (STATE.reviewIndex < STATE.reviewQueue.length) {
            const queued = STATE.reviewQueue[STATE.reviewIndex];
            STATE.reviewIndex++;

            if (!queued.key) continue;
            if (STATE.skippedRowKeys.has(queued.key)) continue;
            if (STATE.processedRowKeys.has(queued.key)) continue;

            const liveRow = findCurrentRowByKey(queued.key);

            if (!liveRow) {
                console.warn("[QBO Bot] Queued row no longer found live, skipping:", queued.key);
                STATE.skippedRowKeys.add(queued.key);
                continue;
            }

            return liveRow;
        }

        return null;
    }

    function setNativeValue(el, value) {
        if (!el) return;

        const proto = el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;

        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);

        el.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: value,
        }));

        el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function key(el, keyName) {
        if (!el) return;

        el.dispatchEvent(new KeyboardEvent("keydown", {
            key: keyName,
            code: keyName,
            bubbles: true,
            cancelable: true,
        }));

        el.dispatchEvent(new KeyboardEvent("keyup", {
            key: keyName,
            code: keyName,
            bubbles: true,
            cancelable: true,
        }));
    }

    async function typeAndMoveNext(el, value) {
        if (!el) return false;

        el.scrollIntoView({ block: "center" });
        el.focus();
        await sleep(150);

        setNativeValue(el, "");
        await sleep(150);

        for (const char of String(value)) {
            setNativeValue(el, el.value + char);
            await sleep(35);
        }

        await sleep(300);
        key(el, "Enter");
        await sleep(250);
        key(el, "Tab");
        await sleep(200);

        return true;
    }

    async function realClick(el) {
        if (!el) return false;

        el.scrollIntoView({ block: "center" });
        await sleep(150);

        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;

        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
            el.dispatchEvent(new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
            }));
        }

        await sleep(100);
        return true;
    }

    async function fillPayee(value, form) {
        if (!value || !form.fields.payee) return true;

        console.log("[QBO Bot] Filling payee:", value);

        const input = form.fields.payee;
        input.scrollIntoView({ block: "center" });
        input.focus();
        await sleep(200);

        setNativeValue(input, "");
        await sleep(200);

        setNativeValue(input, value);
        await sleep(900);

        const wanted = normalise(value);

        const option = [...document.querySelectorAll(
            '[role="option"], [role="menuitem"], .menu-item-label, li, button'
        )].find(el => {
            const text = normalise(el.innerText || el.textContent);
            if (!text) return false;

            if (
                text.includes("add") ||
                text.includes("create") ||
                text.includes("new")
            ) {
                return false;
            }

            return text === wanted || text.includes(wanted) || wanted.includes(text);
        });

        if (!option) {
            console.warn("[QBO Bot] Existing payee option not found:", value);
            return false;
        }

        const clickable =
            option.closest('[role="option"]') ||
            option.closest('[role="menuitem"]') ||
            option.closest("button") ||
            option.closest("li") ||
            option;

        await realClick(clickable);
        await sleep(500);

        key(input, "Tab");
        await sleep(300);

        return true;
    }

    async function fillTaxType(value) {
        const taxInput =
            document.querySelector('input[placeholder="Select tax rate"]') ||
            [...document.querySelectorAll("input")]
                .find(i => cleanText(i.value).includes("GST"));

        if (!taxInput) {
            console.warn("[QBO Bot] Tax input not found");
            return false;
        }

        taxInput.scrollIntoView({ block: "center" });
        taxInput.focus();
        await sleep(200);

        const viewChoices = [...document.querySelectorAll("button")]
            .find(b => cleanText(b.innerText) === "View Choices");

        if (viewChoices) {
            viewChoices.click();
            await sleep(200);
        }

        const wanted = normalise(value);

        const label = [...document.querySelectorAll(".menu-item-label")]
            .find(el => {
                const text = normalise(el.innerText);
                return text === wanted || text.includes(wanted) || wanted.includes(text);
            });

        if (!label) {
            console.warn("[QBO Bot] Tax menu label not found:", value);
            return false;
        }

        const clickable =
            label.closest('[role="menuitem"]') ||
            label.closest("button") ||
            label.closest("li") ||
            label.parentElement ||
            label;

        await realClick(clickable);
        await sleep(200);

        key(taxInput, "Tab");
        await sleep(200);

        return true;
    }

    function moneyToNumber(v) {
        const n = Number(String(v || "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
        return Number.isFinite(n) ? n : null;
    }

    function readForm() {
        const fields = {
            payee: document.querySelector('input[aria-label="Select a payee (optional)"]'),
            bank: document.querySelector('input[aria-label="Select an account"]'),
            total: document.querySelector('input[placeholder="Enter amount"]'),
            taxType: document.querySelector('input[placeholder="Select tax rate"], input[value*="GST"]'),
            taxAmount: document.querySelector('input[placeholder="Enter tax amount"]'),
            description: document.querySelector('input[placeholder="Enter a description"]'),
            category: document.querySelector('input[aria-label="Select a category"]'),
            ref: document.querySelector('input[placeholder="Enter a Ref no."]'),
            memo: document.querySelector('textarea[placeholder="Add note (optional)"]'),
        };

        const values = Object.fromEntries(
            Object.entries(fields).map(([k, el]) => [k, el?.value || ""])
        );

        return { fields, values };
    }

    function buildSearchText(values) {
        return [
            values.payee,
            values.description,
            values.memo,
            values.ref,
        ].join(" ");
    }

    function findRule(searchText) {
        const text = normalise(searchText);

        for (const rule of CONFIG.payeeRules) {
            for (const item of rule.names) {
                const matchText = getRuleNameValue(item);

                if (text.includes(normalise(matchText))) {
                    return {
                        rule,
                        matchedName: matchText,
                        payeeName: getRulePayeeValue(item),
                    };
                }
            }
        }

        return null;
    }

    function decide(values) {
        const searchText = buildSearchText(values);
        const amount = moneyToNumber(values.total);
        const tax = moneyToNumber(values.taxAmount);

        if (!amount) {
            return { action: "skip", reason: "empty amount" };
        }

        if (amount > CONFIG.maxAmount) {
            return { action: "skip", reason: "over $800", amount };
        }

        const match = findRule(searchText);

        if (!match) {
            return { action: "skip", reason: "unknown supplier" };
        }

        const { rule, matchedName, payeeName } = match;

        const decision = rule.apply({
            amount,
            tax,
            values,
            CONFIG,
            matchedName,
            payeeName,
        });

        return {
            matchedRule: rule.type,
            matchedName,
            payee: rule.payee || decision.payee || payeeName || matchedName,
            ...decision,
        };
    }

    async function triggerValidation(form) {
        const lastField =
            form.fields.memo ||
            form.fields.ref ||
            form.fields.taxAmount ||
            form.fields.category ||
            form.fields.description;

        if (!lastField) return;

        lastField.focus();
        await sleep(300);
        key(lastField, "Tab");
        await sleep(1000);
    }

    async function fillForm(decision, form) {
        const okPayee = await fillPayee(decision.payee, form);

        if (!okPayee) {
            console.warn("[QBO Bot] Payee field failed/missing.");
            return false;
        }

        const okBank = await typeAndMoveNext(form.fields.bank, decision.bank);

        if (!okBank) {
            console.warn("[QBO Bot] Bank field failed/missing.");
            return false;
        }

        const okCategory = await typeAndMoveNext(form.fields.category, decision.category);

        if (!okCategory) {
            console.warn("[QBO Bot] Category field failed/missing.");
            return false;
        }

        // Fill description with matched payee name (replace existing)
        if (decision.description && form.fields.description) {
            const descField = form.fields.description;
            const descValue = decision.description;
            descField.scrollIntoView({ block: "center" });
            descField.focus();
            await sleep(150);
            setNativeValue(descField, "");
            await sleep(100);
            setNativeValue(descField, descValue);
            await sleep(200);
            key(descField, "Tab");
            await sleep(200);
            console.log("[QBO Bot] Description filled:", descValue);
        }

        if (decision.taxType) {
            const okTax = await fillTaxType(decision.taxType);

            if (!okTax) {
                console.warn("[QBO Bot] Tax type failed.");
                return false;
            }
        }

        if (decision.taxAmount !== undefined && form.fields.taxAmount) {
            form.fields.taxAmount.focus();
            await sleep(150);

            setNativeValue(form.fields.taxAmount, decision.taxAmount);

            await sleep(300);
            key(form.fields.taxAmount, "Tab");
            await sleep(500);
        }

        await triggerValidation(form);
        return true;
    }

    function getSaveAndNextButton() {
        return [...document.querySelectorAll("button")]
            .find(b => cleanText(b.innerText) === "Save and next");
    }

    function getCloseButton() {
        return document.querySelector('button[aria-label="Close"]');
    }

    async function openNextReview() {
        const next = getNextReviewRow();

        if (!next) return false;

        STATE.currentRowKey = next.key;

        console.log("[QBO Bot] Opening live matched row:", {
            index: STATE.reviewIndex,
            key: STATE.currentRowKey,
        });

        next.reviewButton.scrollIntoView({ block: "center" });
        await sleep(500);

        next.reviewButton.click();
        await sleep(2500);

        return true;
    }

    async function closeFormWithCancel() {
        const cancelBtn = [...document.querySelectorAll("button")]
            .find(b => cleanText(b.innerText) === "Cancel");

        if (cancelBtn) {
            cancelBtn.click();
            await sleep(500);
        } else {
            const close = getCloseButton();
            if (close) close.click();
        }

        for (let i = 0; i < 15; i++) {
            const stillOpen = !!document.querySelector('input[aria-label="Select a payee (optional)"]');
            if (!stillOpen) break;
            await sleep(200);
        }

        await sleep(500);
    }

    async function notifyRunFinished(summary) {
        const text = `QBO Bot finished
Processed: ${summary.processed}
Skipped: ${summary.skipped}
Failed: ${summary.failed}`;

        let toast = document.getElementById("qbo-finish-toast");

        if (!toast) {
            toast = document.createElement("div");
            toast.id = "qbo-finish-toast";
            toast.style.cssText = `
                position: fixed;
                right: 20px;
                top: 220px;
                z-index: 999999;
                background: #1e1e1e;
                color: #fff;
                padding: 12px 14px;
                border-radius: 8px;
                box-shadow: 0 2px 12px rgba(0,0,0,.3);
                font-family: Arial, sans-serif;
                font-size: 13px;
                white-space: pre-line;
            `;
            document.body.appendChild(toast);
        }

        toast.textContent = text;
        setTimeout(() => toast.remove(), 3000);

        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.type = "sine";
            osc.frequency.value = 880;
            osc.start();

            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

            osc.stop(ctx.currentTime + 0.5);
        } catch (e) {}

        if ("Notification" in window) {
            if (Notification.permission === "granted") {
                new Notification("QBO Bot Finished", { body: text });
            } else if (Notification.permission !== "denied") {
                const perm = await Notification.requestPermission();

                if (perm === "granted") {
                    new Notification("QBO Bot Finished", { body: text });
                }
            }
        }
    }

    async function runQboReceiptAutomation() {
        if (STATE.running) {
            console.warn("[QBO Bot] Already running.");
            return;
        }

        if (CONFIG.autoClearOnRun) {
            clearState();
            console.warn("[QBO Bot] Auto-cleared state before run.");
        }

        STATE.running = true;

        try {
            while (STATE.running) {
                const formOpen = !!document.querySelector('input[aria-label="Select a payee (optional)"]');

                if (!formOpen) {
                    const opened = await openNextReview();

                    if (!opened) {
                        console.log("[QBO Bot] No more queued Review rows on this page.");
                        break;
                    }
                }

                const form = readForm();
                const decision = decide(form.values);

                console.group(`[QBO Bot] Receipt ${STATE.processed + STATE.skipped + STATE.failed + 1}`);
                console.log("Current row key:", STATE.currentRowKey);
                console.log("Values:", form.values);
                console.log("Decision:", decision);
                console.groupEnd();

                if (decision.action !== "fill") {
                    STATE.skipped++;

                    if (STATE.currentRowKey) {
                        STATE.skippedRowKeys.add(STATE.currentRowKey);
                    }

                    console.warn("[QBO Bot] Skipped:", decision.reason);

                    await closeFormWithCancel();
                    STATE.currentRowKey = null;
                    continue;
                }

                const ok = await fillForm(decision, form);

                if (!ok) {
                    STATE.failed++;

                    if (STATE.currentRowKey) {
                        STATE.skippedRowKeys.add(STATE.currentRowKey);
                    }

                    console.warn("[QBO Bot] Fill failed. Fields found:", {
                        payee: !!form.fields.payee,
                        bank: !!form.fields.bank,
                        category: !!form.fields.category,
                        taxType: !!form.fields.taxType,
                        taxAmount: !!form.fields.taxAmount,
                        values: form.values,
                        decision,
                    });

                    await closeFormWithCancel();
                    STATE.currentRowKey = null;
                    continue;
                }

                if (!CONFIG.autoSave) {
                    console.warn("[QBO Bot] Filled one form. autoSave is false; stopping before Save and next.");
                    break;
                }

                const saveBtn = getSaveAndNextButton();

                if (!saveBtn) {
                    STATE.failed++;

                    if (STATE.currentRowKey) {
                        STATE.skippedRowKeys.add(STATE.currentRowKey);
                    }

                    console.warn("[QBO Bot] Save and next not found. Skipping row. Not clicking Create expense.");

                    await closeFormWithCancel();
                    STATE.currentRowKey = null;
                    continue;
                }

                saveBtn.click();
                STATE.processed++;

                if (STATE.currentRowKey) {
                    STATE.processedRowKeys.add(STATE.currentRowKey);
                }

                STATE.currentRowKey = null;

                await sleep(1800);
                await closeFormWithCancel();
                await sleep(1000);
            }
        } finally {
            STATE.running = false;

            console.log("[QBO Bot] Finished:", {
                processed: STATE.processed,
                skipped: STATE.skipped,
                failed: STATE.failed,
                skippedRowsRemembered: STATE.skippedRowKeys.size,
                processedRowsRemembered: STATE.processedRowKeys.size,
                queuedRows: STATE.reviewQueue.length,
                reviewIndex: STATE.reviewIndex,
                autoSave: CONFIG.autoSave,
                autoClearOnRun: CONFIG.autoClearOnRun,
            });

            await notifyRunFinished({
                processed: STATE.processed,
                skipped: STATE.skipped,
                failed: STATE.failed,
            });
        }
    }

    function addControlPanel() {
        if (document.getElementById("qbo-receipt-bot-panel")) return;

        const PANEL_POS_KEY = "qbo_bot_panel_pos";

        const panel = document.createElement("div");
        panel.id = "qbo-receipt-bot-panel";
        panel.style.cssText = `
            position: fixed;
            z-index: 999999;
            background: white;
            border: 1px solid #ccc;
            border-radius: 8px;
            padding: 0;
            box-shadow: 0 2px 12px rgba(0,0,0,.2);
            font-family: Arial, sans-serif;
            font-size: 13px;
            user-select: none;
        `;

        // --- Draggable header ---
        const header = document.createElement("div");
        header.textContent = "QBO Bot";
        header.style.cssText = `
            padding: 6px 12px;
            background: #2c2c2c;
            color: #fff;
            font-weight: bold;
            border-radius: 8px 8px 0 0;
            cursor: grab;
            font-size: 13px;
        `;

        const body = document.createElement("div");
        body.style.cssText = "padding: 10px; display: flex; flex-wrap: wrap; gap: 6px;";

        panel.appendChild(header);
        panel.appendChild(body);

        // --- Restore saved position or default to top-right ---
        function clampPos(x, y) {
            const maxX = window.innerWidth - panel.offsetWidth;
            const maxY = window.innerHeight - panel.offsetHeight;
            return {
                x: Math.max(0, Math.min(x, maxX)),
                y: Math.max(0, Math.min(y, maxY)),
            };
        }

        function getSavedPos() {
            try {
                const raw = localStorage.getItem(PANEL_POS_KEY);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (
                    typeof parsed.x === "number" &&
                    typeof parsed.y === "number"
                ) {
                    return parsed;
                }
            } catch (e) {
                console.warn("[QBO Bot] Failed to parse saved panel pos:", e);
            }
            return null;
        }

        function applyPos(x, y) {
            const clamped = clampPos(x, y);
            panel.style.left = clamped.x + "px";
            panel.style.top = clamped.y + "px";
        }

        function savePos(x, y) {
            try {
                localStorage.setItem(
                    PANEL_POS_KEY,
                    JSON.stringify({ x, y })
                );
            } catch (e) {
                console.warn("[QBO Bot] Failed to save panel pos:", e);
            }
        }

        // --- Drag logic ---
        let dragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        header.addEventListener("mousedown", (e) => {
            // Only start drag on left-click
            if (e.button !== 0) return;
            dragging = true;
            header.style.cursor = "grabbing";
            const rect = panel.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            e.preventDefault();
        });

        document.addEventListener("mousemove", (e) => {
            if (!dragging) return;
            const newX = e.clientX - dragOffsetX;
            const newY = e.clientY - dragOffsetY;
            applyPos(newX, newY);
        });

        document.addEventListener("mouseup", () => {
            if (!dragging) return;
            dragging = false;
            header.style.cursor = "grab";
            const rect = panel.getBoundingClientRect();
            savePos(rect.left, rect.top);
        });

        // --- Buttons ---
        const runBtn = document.createElement("button");
        runBtn.textContent = "Run QBO Bot";
        runBtn.style.cssText = "padding:8px 12px; cursor:pointer;";

        const stopBtn = document.createElement("button");
        stopBtn.textContent = "Stop";
        stopBtn.style.cssText = "padding:8px 12px; cursor:pointer;";

        const clearBtn = document.createElement("button");
        clearBtn.textContent = "Clear State";
        clearBtn.style.cssText = "padding:8px 12px; cursor:pointer;";

        runBtn.onclick = () => runQboReceiptAutomation();

        stopBtn.onclick = () => {
            STATE.running = false;
            console.warn("[QBO Bot] Stop requested.");
        };

        clearBtn.onclick = () => {
            if (STATE.running) {
                console.warn("[QBO Bot] Cannot clear while running. Stop first.");
                return;
            }

            clearState();
        };

        body.appendChild(runBtn);
        body.appendChild(stopBtn);
        body.appendChild(clearBtn);
        document.body.appendChild(panel);

        // --- Apply initial position ---
        const saved = getSavedPos();
        if (saved) {
            applyPos(saved.x, saved.y);
        } else {
            // Default: top-right with 20px margin
            applyPos(window.innerWidth - panel.offsetWidth - 20, 20);
        }

        // Re-clamp on resize
        window.addEventListener("resize", () => {
            const rect = panel.getBoundingClientRect();
            applyPos(rect.left, rect.top);
        });
    }

    function waitForBodyThenAddPanel() {
        if (document.body) {
            addControlPanel();
            return;
        }

        setTimeout(waitForBodyThenAddPanel, 500);
    }

    waitForBodyThenAddPanel();

    window.QBO_RECEIPT_BOT = {
        run: runQboReceiptAutomation,
        stop: () => {
            STATE.running = false;
        },
        clear: () => {
            if (STATE.running) {
                console.warn("[QBO Bot] Cannot clear while running. Stop first.");
                return;
            }

            clearState();
        },
        state: STATE,
        config: CONFIG,
        decide,
        findRule,
    };

    console.log("[QBO Bot] Loaded. Use floating button or run QBO_RECEIPT_BOT.run()");
})();
