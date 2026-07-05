# Lead Review Tool — Project Handover Document

## 1. Project Summary

A desktop Electron application that lets a user load an Excel sheet of leads/customers, batch-open Google search tabs for a chosen column's values, and triage each one (Green/Yellow/Red) via a persistent floating mini-player, cycling through the sheet in user-defined batch sizes until the full list is reviewed and tagged. Tags are written back into the sheet and exportable at any time.

**Core user flow:**
1. Open app → load an Excel file.
2. Pick which column contains the search term (e.g., firm name).
3. Set batch size X (e.g., 5).
4. Click "Start" → app opens X in-app browser tabs, each auto-searching Google for that row's value.
5. Mini-player appears, listing the X tab names with Green/Yellow/Red buttons per tab.
6. User reviews each tab manually, tags each row via the mini-player.
7. Once all X are tagged, "Next Batch" becomes active in the mini-player.
8. Clicking it closes/replaces the current batch's tabs with the next X rows, refreshes the mini-player list.
9. Repeat until sheet exhausted.
10. User can export the sheet (with a new "Status" column) at any point, not just at the end.

---

## 2. Technology Stack

- **Framework:** Electron (latest stable)
- **Renderer UI:** Plain HTML/CSS/JS, or React if preferred for state management — React recommended given multiple synced views (main window tab-strip + mini-player window) sharing state.
- **Excel parsing/writing:** SheetJS (`xlsx` npm package)
- **State management:** Centralized in Electron **main process**, since two renderer windows (main app window + mini-player window) need synchronized state. Use IPC (`ipcMain`/`ipcRenderer`) for communication; consider `electron-store` or simple in-memory JS object + periodic autosave to disk (JSON) for crash recovery.
- **Tab rendering:** Electron `BrowserView` (NOT `<webview>` tag — `BrowserView` is the modern, better-supported approach for embedding multiple browsable surfaces inside one window with a custom tab-strip UI built in the host window's renderer).
- **Packaging:** `electron-builder` for producing a Windows/Mac/Linux installable build.

---

## 3. Window Architecture

### 3.1 Main Application Window
- Standard frameed window (has its own custom tab-strip UI at the top, similar to a browser).
- Contains:
  - A landing/setup view (file picker, column selector, batch size input, "Start" button) shown before a batch is active.
  - A tab-strip area once a batch is running, each tab = one `BrowserView` attached/detached as the user clicks between tabs in the strip.
  - Each `BrowserView` loads `https://www.google.com/search?q=<encoded row value>` on creation.
- **Tabs are never auto-closed.** Per user's explicit requirement (Section 6 decision #2 from planning conversation): tabs only close via explicit user action (clicking a manual "close" control on the tab strip, if you choose to add one) — tagging a row does NOT close its tab automatically. Closing/not-closing on tag is a UI nicety but must default to "stays open" per requirement.

### 3.2 Mini-Player Window
- A **separate, frameless, always-on-top `BrowserWindow`**, small footprint, positioned bottom-right of the screen by default (user should be able to drag it; Electron frameless windows support drag via a custom titlebar-less drag region defined in CSS with `-webkit-app-region: drag`).
- Lists the current batch's row names (e.g., "Sachin Gujar & Associates") each with three colored buttons/pips: Green, Yellow, Red.
- Clicking a color tag:
  - Updates state (IPC message to main process: `{ rowId, tag: 'green' | 'yellow' | 'red' }`).
  - Visually marks that row's entry in the mini-player as tagged (e.g., highlight, checkmark, dim the buttons for that row once tagged — but don't hide it, user should see full batch status at a glance).
  - Clicking the row name itself (not the color buttons) should switch focus in the main window to that tab (bring `BrowserView` to front, focus main window) — small but important usability detail so mini-player also functions as tab navigation, not just tagging.
- A "Next Batch" button:
  - Disabled/greyed out until all X rows in the current batch have a tag.
  - On click: sends IPC to main process → main process determines next X unprocessed rows from the sheet, closes/destroys current batch's `BrowserView`s (per user's requirement, this is one of the few auto-close moments — the transition to a new batch; single manual close of the whole batch, not per-tab auto-close during tagging), opens new ones, tells mini-player to refresh its row list.
  - Batch size X should carry over from the initial setting; consider allowing user to change X at this point too (nice-to-have, not core requirement) via a small settings icon in the mini-player.

### 3.3 Window Lifecycle Rules (finalized in planning discussion)
- **App launch:** main window opens; mini-player does NOT show yet (no batch active).
- **Batch starts:** mini-player spawns automatically alongside the tab batch opening. This is not a manual toggle — starting a batch always shows the mini-player.
- **Main window minimized:**
  - Because tabs are `BrowserView`s embedded in the main window (per architecture decision in 3.1), minimizing the main window necessarily hides the tabs from view.
  - Therefore, **the mini-player must also minimize/hide when the main window is minimized** — there's nothing meaningful to tag if the tabs themselves aren't visible.
  - Implementation: listen for the main `BrowserWindow`'s `minimize` event via `win.on('minimize', ...)`, then call `miniPlayerWindow.hide()`. On `restore` event, call `miniPlayerWindow.show()`.
  - This is the specific rule the user confirmed: *"If the browser in which I am looking at the different customer's data is open in that app itself, then obviously minimize the mini player when the app is being minimized."* Since the chosen architecture keeps tabs inside the app (not separate OS windows), this branch of the logic is the one that applies. The alternate branch (separate OS-level browser windows staying open independently, mini-player staying visible through main-window minimize) was discussed but NOT chosen — documented here only so a future dev doesn't accidentally build the wrong branch.
- **App fully closed/quit:** mini-player closes with it (default Electron behavior — all windows belonging to one app process terminate together on `app.quit()` unless explicitly detached, which we are not doing). No special-case code needed here beyond ensuring the mini-player window isn't set to survive independently.

---

## 4. Data Model

### 4.1 In-memory representation (main process holds source of truth)

```js
{
  filePath: string,              // original uploaded file path
  searchColumn: string,          // column name/header chosen by user for Google search
  batchSize: number,             // X, user-defined
  rows: [
    {
      rowId: string,             // stable unique id, e.g. row index or a generated UUID
      originalData: { ...allColumnsFromExcelForThisRow },
      searchValue: string,       // the value from searchColumn, used to build the Google query
      status: 'unprocessed' | 'in_batch' | 'tagged',
      tag: null | 'green' | 'yellow' | 'red',
      tabOpenedAt: timestamp | null
    },
    ...
  ],
  currentBatch: [rowId, rowId, ...],   // rowIds currently open as tabs
  processedCount: number,
  totalCount: number
}
```

### 4.2 Excel I/O details
- **Reading:** On file load, use SheetJS `XLSX.readFile()` → `XLSX.utils.sheet_to_json()` to get an array of row objects keyed by header. Preserve original column order and all original columns — do not drop unused columns, since the export must return a sheet the user can still use normally, just with an added status column.
- **Column selection UI:** after reading, populate a dropdown with the sheet's header row so the user picks which column holds the search term. Validate: warn if selected column has empty/blank values for some rows (skip those rows or flag them, user's choice — recommend flagging with a distinct status like `'skipped_no_data'` rather than silently dropping).
- **Multi-tab sheets:** if the uploaded Excel file has multiple sheet tabs internally, prompt the user to pick which internal sheet/tab to use as the data source (don't assume sheet 1) — get `workbook.SheetNames` and show a picker if there's more than one.
- **Writing/exporting:** On export, take the working `rows` array, map back to original column shape, add one new column (default header name `"Lead Status"`, values `Green/Yellow/Red/(blank if untagged)`), write via `XLSX.utils.json_to_sheet()` + `XLSX.writeFile()`. Prompt a save-as dialog (Electron's `dialog.showSaveDialog`) defaulting to `<originalfilename>_reviewed.xlsx` so the source file is never silently overwritten.
- **Autosave/crash recovery:** Since tagging progress is valuable manual work, periodically (e.g., every 30 seconds, or on every tag event — tag events are infrequent enough that saving on every single tag is safe and simplest) write the current `rows` state to a local JSON file in the app's userData directory (`app.getPath('userData')`). On next launch, if such a recovery file exists, offer to resume the previous session rather than forcing a fresh file load.

---

## 5. Batch Logic Detail

- **Determining "next X":** always pull the next X rows from the full list whose `status === 'unprocessed'`, in original sheet order (top to bottom), skipping any flagged `'skipped_no_data'`. Do not let the user re-open an already-tagged row's tab via the normal "next batch" flow (that's a "review/edit past tags" feature, separate concern — see Section 7 possible extensions).
- **Partial batches:** if fewer than X unprocessed rows remain (e.g., 3 rows left but batch size is 5), open however many remain; the "Next Batch" button/logic should recognize the sheet is now fully exhausted after this final partial batch is tagged, and show a completion state instead of another "Next Batch" prompt (e.g., "All leads reviewed — export?").
- **Tab-to-row binding:** each `BrowserView` created for a batch must carry a reference back to its `rowId` (e.g., in a `Map<BrowserView, rowId>` held in the main process), so that when the mini-player sends a tag event, the main process knows exactly which row/tab pairing it refers to, independent of tab order or window focus.

---

## 6. Google Search Behavior (confirmed requirement)

- The tool performs a **literal, real Google search** — i.e., navigates each `BrowserView` to `https://www.google.com/search?q=<URL-encoded searchValue>`. This was explicitly confirmed over the alternative of jumping straight to a specific site (e.g., LinkedIn/JustDial directly) or auto-navigating to the top result. Do not implement any "smart redirect" behavior unless requested later.
- Standard URL encoding (`encodeURIComponent`) must be applied to the search value to handle special characters (e.g., `&` in "Sachin Gujar & Associates").
- No API-based search (e.g., Google Custom Search API) — this is literally driving a real Google Search results page inside the embedded browser view, exactly as if the user typed it into a normal browser and hit enter.

---

## 7. UI/UX Details Worth Specifying for a Developer

- **Mini-player styling:** modeled after a Spotify desktop miniplayer — small, compact, always-on-top, minimal chrome (no OS titlebar), rounded corners optional, dark theme likely fits given "operator console" aesthetic preferences the user has expressed in other projects (Strata's monochrome/Palantir-style direction) — worth carrying that same visual language here for consistency across the user's tools, though this is a suggestion, not a stated requirement for this specific tool.
- **Row list in mini-player when batch size is large:** if X is large (e.g., 15+), the mini-player list needs to be scrollable within a fixed max height rather than growing the window indefinitely.
- **Visual tagged-state feedback:** once a row is tagged, its entry should visually reflect the chosen color persistently (e.g., colored left-border or background tint matching the tag) so the user can see at a glance which rows in the current batch still need attention.
- **Drag-to-reposition:** mini-player should be draggable since "bottom-right of screen" is a default position, not a hard lock — use `-webkit-app-region: drag` on a header strip within the mini-player's HTML.
- **Main window tab-strip:** should show the searchValue (or a shortened version) as the tab label, so the user can visually tell tabs apart, mirroring the same names shown in the mini-player for consistency.

---

## 8. Explicit Decisions Already Made (do not re-litigate without reason)

1. Google search is literal (`google.com/search?q=...`), not a redirect to a specific site or top result.
2. Tabs are closed **only** by explicit user action — no auto-close on tagging.
3. Built as an **Electron app**, not a Chrome extension — Excel reading, browser tabs, and mini-player all live in one process/app.
4. Tabs are implemented as in-app `BrowserView`s inside the main window's own tab-strip, **not** separate OS-level `BrowserWindow`s per tab. This decision drives the minimize-behavior logic in Section 3.3.
5. Mini-player auto-shows when a batch starts; auto-hides/minimizes in sync with the main window's minimize state (since tabs live inside that same window); fully closes when the app quits.
6. Export never silently overwrites the original file — always save-as with a suggested new filename.

---

## 9. Open Items / Not Yet Decided (flag to user before building)

- Exact default mini-player dimensions and exact default screen position (bottom-right — but exact pixel offset from screen edge not yet specified).
- Whether "Next Batch" should allow changing X mid-session.
- Whether there should be a "review past tags" mode to revisit/edit already-tagged rows before final export.
- Whether a manual per-tab "close" control should exist on the tab-strip (implied useful, not explicitly requested).
- Exact column header name for the exported status column (defaulted here to `"Lead Status"` — confirm with user before finalizing).
- Whether multiple Excel files / multiple sessions should be supported (e.g., switching between a CA-firm leads sheet and a different vertical's leads sheet) or if the tool is single-file-per-session only.

---

## 10. Suggested Build Order (for whoever picks this up)

1. Basic Electron shell: main window + file picker + SheetJS read/parse + column/sheet-tab selection UI.
2. Batch logic in main process (in-memory data model from Section 4.1), no UI polish yet — just prove "start batch" correctly identifies the next X unprocessed rows.
3. `BrowserView` tab-strip in main window, each loading the correct Google search URL for its bound row.
4. Mini-player window: static list first (no tagging yet), confirm IPC round-trip between mini-player and main process.
5. Wire up tagging buttons → state updates → visual feedback in mini-player.
6. Wire up "Next Batch" → closes current `BrowserView`s, opens next batch, refreshes mini-player.
7. Minimize/restore sync behavior between main window and mini-player (Section 3.3).
8. Export to Excel (save-as flow) + autosave/crash-recovery JSON.
9. Polish pass: styling, drag-to-reposition mini-player, tab-strip labels, scrollable mini-player list for large X.
