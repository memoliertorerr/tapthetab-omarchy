# TapTheTab → JavaScript port specification

Written 2026-10-30 by a research pass over the Swift app (GPT-6.1 Sol, read-only). It specifies the existing Swift behaviour and recommends the MVP boundary; it makes no assumptions about Linux or Hyprland APIs (those are in [`omarchy-plugin-api.md`](omarchy-plugin-api.md)). When this document and the Swift code or tests disagree, the Swift code and tests win — fix this document in the same change.

Source paths are relative to `../tapthetab` (the macOS repo):

- `C/` = `Sources/TapTheTabCore/`
- `T/` = `Tests/TapTheTabCoreTests/`
- `A/` = `Sources/TapTheTab/App/`
- `S/` = `Sources/TapTheTab/System/`

## 0. Engine constraints for the port (added by the orchestrator)

The JS runs in two engines: Node (tests) and Quickshell's QML JavaScript engine (QV4, the real runtime). Write for the smaller one:

- ES5 style as Omarchy does: `var`, `function`, no classes, no arrow functions, ending with `if (typeof module !== "undefined") module.exports = {...}`.
- **Do not rely on `Intl` (including `Intl.Segmenter`) or on regex Unicode property escapes (`\p{L}`, the `u` flag).** Their availability in QV4 is unverified. `String.prototype.normalize` is likely available but treat it as feature-detected with a fallback.
- Grapheme clusters therefore need a small built-in segmenter that covers what the tests and real window titles need: base + combining marks, ZWJ sequences, variation selectors, emoji skin-tone modifiers, regional-indicator pairs, CRLF, and surrogate pairs. Document what it does not cover.
- Folding (case-, diacritic- and width-insensitive, one folded element per grapheme): NFD where available then strip combining marks, map fullwidth ASCII (U+FF01–U+FF5E) to ASCII, lowercase, keep the first resulting character. A small table for common precomposed Latin letters is the fallback when `normalize` is missing.
- Letter/number classification without `\p{}`: digits via ranges; letters via `ch.toLowerCase() !== ch.toUpperCase()` plus CJK/Kana/Hangul ranges. Document the approximation.
- Whether the modules really load in QV4 is checked in the VM job (TTO4), not by Node.

## 1. Ranked port priorities

| Priority | Types or behaviour | Port scope |
|---|---|---|
| MVP 1 | `SwitcherItem`, `ItemID`, `RankedItem` | Stable item identity and plain snapshots underpin ordering, selection preservation and search history. Preserve window vs windowless-app identity if supporting both. `C/SwitcherItem.swift:3–69`; `C/SwitcherSession.swift:61–70`. |
| MVP 2 | `RecencyTracker`; behavioural rules from `FocusTracker` | Real focus history, with stable input-order fallback for unknown windows. Port the rules, replace the macOS observation layer. `C/RecencyTracker.swift:3–42`; `S/FocusTracker.swift:38–74`. |
| MVP 3 | `SwitcherSession`, `SwitcherInput`, `SwitcherEffect` | Selection, cycling, typing, clearing, locking, activation and live item replacement. `C/SwitcherSession.swift:19–58,73–281`. |
| MVP 4 | `FuzzyMatcher`, `FuzzyMatch` | Exact ranking and highlight offsets are central to the experience. `C/FuzzyMatcher.swift:19–25,28–193`. |
| MVP 5 | `KeyRouter`; logical `Shortcut`/modifier representation | Preserve routing precedence and typing while trigger modifiers remain held. Replace Carbon numeric key codes. `C/KeyRouter.swift:3–14,56–96`; `C/Shortcut.swift:101–124`. |
| MVP 6 | `ItemFilter`, `FilterOptions`, `FilterContext`, `SwitcherScope` | Stable filtering, all-window and active-app scopes; one-entry-per-app is cheap pure logic but optional to expose. `C/ItemFilter.swift:3–29,68–130`. |
| MVP 7 | `Configuration`, `Trigger`, `Behavior`, `Appearance`, `ConfigStore` | Defaults, lenient decoding, validation. On Omarchy the store is the plugin's inline settings (see PLAN Design Decisions), so port the lenient decode/validate, not the file handling. `C/Configuration.swift:3–34,91–328`; `C/ConfigStore.swift:29–119`. |
| MVP 8 | `SearchMemory` | Needed for "remembers what you picked". Bounded, deterministic, memory-only. `C/SearchMemory.swift:3–43,71–172`; `README.md:85–86`. |
| Later | `ItemOrdering` | Grouping, pinning, display-first. Optional because they alter plain MRU order. `C/ItemOrdering.swift:3–112`. |
| Later | `QuickSelect`, peek, `DisplayMove` | `C/QuickSelect.swift:3–23`; `C/SwitcherSession.swift:134–141`; `C/DisplayMove.swift:8–38`. |
| Later | `GridLayout`, `PanelLayout`, `PanelPlacement`, `BlockPosition` | A list MVP can use `columns = 1`; the source supports this. `docs/ARCHITECTURE.md:45–47`; `C/SwitcherSession.swift:84–86`. |
| Later | `ColorTheme`, `ThemePreset`, `ThemeGradient`, `ColorMath`, `GrainTexture` | Visual fidelity. `C/ColorTheme.swift`. |
| Later | `LargePreviewCaptureSchedule`, `PreviewImageRetention`, `PreviewSelectionAnimation` | Portable responsiveness policies for previews; revisit in TTO7. `C/LargePreviewPolicy.swift:3–24,77–90,140–148`. |
| Later/adapt | `AutomationCommand`, `DiagnosticsReport`, trigger collision checks | Portable ideas; fields need platform replacement. |
| Drop | `WineNames`, `SpaceLayout`, `OtherSpaceWindows`, AX `WindowAdmission` | macOS naming, Spaces and Accessibility admission. `C/WindowAdmission.swift`. |
| Drop | Update checker/installer, symbolic hotkey takeover, AX/CGS/SLPS, ScreenCaptureKit permission/capture, menu bar/login | macOS app and distribution boundary. |

## 2. MVP algorithms

### Item representation and pipeline

An item has `id`, `pid`, `appName`, optional `bundleID`, `title`, minimized/hidden/fullscreen/active-Space flags and optional display identity. Defaults: false for minimized/hidden/fullscreen, true for active-Space membership, empty title, absent bundle/display IDs. `isWindowless` depends on the ID variant, not the title. `displayTitle` trims surrounding whitespace and newlines; an empty result falls back to the untrimmed app name. (`C/SwitcherItem.swift:22–69`.)

On Linux: `appId` (the Wayland app id) plays the role of `bundleID`; the Hyprland window address is the window id; workspace replaces Space; monitor replaces display.

Source pipeline:

```text
snapshot
→ RecencyTracker.ordered
→ ItemFilter.apply
→ optional displayFirst
→ optional groupedByApp
→ pinnedFirst
→ SwitcherSession
→ fuzzy ranking only while searching
```

Ordering runs before session construction. Search-score ties preserve the supplied order. (`A/SwitcherCoordinator.swift:454–470`; `C/SwitcherSession.swift:217–240`.)

### FuzzyMatcher: exact scoring

Use **extended grapheme clusters** (Swift `Character`) throughout: token lengths, field lengths, match offsets, deletion and prefix lengths. UTF-16 offsets or code-point arrays alone will not reproduce the emoji test. Highlight indices address `displayTitle`, not the untrimmed title. (`C/FuzzyMatcher.swift:7–10,35–38,184–193`; `T/FuzzyMatcherTests.swift:159–180`.)

1. **Tokenize and fold.** Split the query on Unicode whitespace. Fold each grapheme independently (case-, diacritic- and width-insensitive), lowercase it and keep only its first resulting grapheme; fall back to the original if folding produces nothing. One folded element per original grapheme. Discard empty tokens. No tokens → score `0` and empty highlights. (`C/FuzzyMatcher.swift:28–38,184–193`.) Lowercasing alone is insufficient. Never expand one grapheme into several positions. (`T/FuzzyMatcherTests.swift:242–245`.)

2. **Match each token separately against both fields:** folded `displayTitle` and folded `appName`. Every token must match at least one field. A token cannot span title and app name. Tokens may hit different fields; token order does not constrain matching. (`C/FuzzyMatcher.swift:44–73`; `T/FuzzyMatcherTests.swift:51–74`.)

3. **Prefer a contiguous occurrence whenever one exists in a field.** Examine every occurrence; score:

   ```text
   100 + 12 × tokenLength
       + 30 if the occurrence starts at field index 0
       + 25 if it starts at a word start
       + 10 if it ends at field end, or the next original grapheme is neither a letter nor a number
   ```

   Keep the highest; equal scores keep the earliest (replacement uses strict `>`). Return without trying subsequence matching. (`C/FuzzyMatcher.swift:87–107`.)

4. **Word starts use original, unfolded text.** An index is a word start when it is 0, follows whitespace or any of `-_./\:|()[]{}—–·,`, crosses lowercase→uppercase, or crosses non-number→number. "Word continuation" = letter or number. (`C/FuzzyMatcher.swift:169–181`.)

5. **Otherwise match a subsequence.** For each token grapheme, scan forward from the cursor. Remember the earliest matching non-word-start position, but prefer the first matching word start encountered. Override that preference when the remembered plain hit is immediately adjacent to the previous match. Also abandon a jump to a later word start if the remaining token cannot be matched after it; use the earlier plain hit instead. Advance the cursor past the chosen position. A missing grapheme → no match. (`C/FuzzyMatcher.swift:109–137,159–166`.)

6. **Score the subsequence:**

   ```text
   +10 per matched grapheme
   +18 per matched grapheme at a word start
   +15 if the first match is at field index 0
   for every match after the first:
     +14 if adjacent to the previous match
     −min(skipped graphemes, 10) otherwise
   final = max(sum, 1)
   ```

   (`C/FuzzyMatcher.swift:139–150`.)

7. **Choose the field per token.** Add `8` to any successful app-name score. Add only the higher of title/app to the total; a tie chooses title. Highlight the winning field. Also highlight the losing field when its chosen indices are contiguous; a scattered losing match gets no highlights. (`C/FuzzyMatcher.swift:45–71`.)

8. **Combine and penalize.** Union highlight positions across tokens, sorted ascending. Repeated tokens may add score repeatedly; highlights stay unique. If the original display-title and app-name character arrays are identical, union both fields' highlights into both labels. Subtract `floor(min(displayTitleLength, 120) / 12)` once. No final minimum clamp. (`C/FuzzyMatcher.swift:40–42,74–83`; `T/FuzzyMatcherTests.swift:226–228`.)

9. **Rank in the session.** Sort descending by `match.score + SearchMemory.boost`; ties by ascending original offset. Raw score and highlights stay unchanged; the boost affects order only. (`C/SwitcherSession.swift:221–229`; `T/SwitcherSessionTests.swift:372–381`.)

### RecencyTracker and FocusTracker

`touch(id)` increments a wrapping counter and assigns the new stamp to that id; repeated touches replace it. Ordering: stamped items first, newest first; unstamped items keep their supplied order after them. Stamps for absent items never insert items. Window and app ids are separate namespaces. (`C/RecencyTracker.swift:8–42`; `T/RecencyTrackerTests.swift:86–100`.)

`forget(id)` removes one stamp; `prune(keeping)` keeps only supplied ids; neither resets the clock. (`C/RecencyTracker.swift:19–30`.)

macOS `FocusTracker` rules worth keeping:

- Ignore activation of TapTheTab itself (on Omarchy: our own layer surface never becomes an active window, but ignore it if it does).
- On app activation record its focused window, else its windowless-app id.
- Focused/main-window changes record focus.
- Keep stamps for windows missing from a temporary snapshot while their owner is alive; prune on owner lifetime, not snapshot membership (on Hyprland: prune on `closewindow`).
- Activation through the switcher explicitly touches the activated item after closing the session.

(`S/FocusTracker.swift:42–74,81–91`; `A/SwitcherCoordinator.swift:307–312`.)

### SwitcherSession recomputation and replacement

State: original `items`, literal `query`, ranked `visible`, nullable `selectedIndex`, `isLocked`, `columns ≥ 1`, `wrapsAround`, immutable `startsOnPrevious`, and a search-memory snapshot. Default construction selects index `1` when there are ≥ 2 items and `startsOnPrevious`, else `0`; no items → no selection. (`C/SwitcherSession.swift:78–112,232–240`.)

`isSearching` = literal query non-empty. Recompute treats a query trimmed of whitespace as empty for ranking. For an empty-ranking query, visible entries have no match and keep input order. (`C/SwitcherSession.swift:119,217–240`.)

Selection after recompute:

```text
requested preserved id still visible              → that id's new index
no visible items                                  → null
literal query empty + startsOnPrevious + count > 1 → 1
otherwise                                         → 0
```

Typing requests no preserved id. Backspace preserves the selected id while the resulting query stays non-empty. (`C/SwitcherSession.swift:143–156,232–240`.)

`replaceItems(newItems)` reapplies query and memory ranking, preserving selection by id. If the selected id disappears, keep its previous index clamped to the new last index; empty → no selection. With no prior selected id, normal opening/search rules apply. Item contents are replaced even when identity is unchanged. (`C/SwitcherSession.swift:194–207`; `T/SwitcherSessionTests.swift:535–582`.)

The session returns effects; it does **not** mark itself closed. The caller closes the presentation and stops routing. (`C/SwitcherSession.swift:45–58,163–178`.)

### KeyRouter: precedence matters

Process key-downs in this order:

1. Trigger key → next, or previous with Shift. Wins even when it is a letter, Space, arrow or digit.
2. Arrows → movement; Home/PageUp → first; End/PageDown → last.
3. Return/keypad Enter → commit; Escape → cancel.
4. Backspace **and forward Delete** → deleteBackward when search is enabled.
5. Tab always cycles, even for a non-Tab trigger; Shift reverses.
6. Shift+Space → peek; unshifted Space with no search → lock open.
7. Optional quick-select digits (Later).
8. Remaining text/action handling.

(`C/KeyRouter.swift:56–82`; `T/KeyRouterTests.swift:21–32,197–200,287–289`.)

For remaining keys require exactly one grapheme of layout-aware text produced ignoring modifiers other than Shift. Subtract trigger modifiers (Shift removed) from current modifiers. Extra Control or Command (on Linux: Control or Super) blocks typing and Shift-letter actions; extra Option/Alt does not block text. (`C/KeyRouter.swift:7–8,32–34,52,84–87`.)

Shift plus `w/m/f/h/q/d/x/p` emits window actions (Later on Linux — see PLAN). Other Shift letters type uppercase. Remaining letters, numbers, punctuation, symbols and literal Space enter search when enabled. Missing text, multiple graphemes and non-printables are ignored. (`C/KeyRouter.swift:36–38,89–96`; `T/KeyRouterTests.swift:78–101,111–144`.)

The coordinator suppresses other configured triggers' keys during a session. If an unlocked session's required trigger modifiers are missing on a later key-down, it processes release instead of that key: losing any required Command/Option/Control counts as release; Shift/Fn do not hold the session open. (`A/SwitcherCoordinator.swift:168–189`.) This last rule is a useful safety net for TTO5: any key event without Alt held means Alt was released.

### ItemFilter

Filtering preserves survivor order and precedes scope reduction. Reject own-process items, case-insensitive excluded bundle ids, disallowed windowless entries, disallowed minimized windows and disallowed hidden apps. A missing bundle id never matches the exclusion list. (`C/ItemFilter.swift:82–109`.)

`currentSpaceOnly` rejects an off-Space item only when it is neither minimized, hidden nor windowless. `currentDisplayOnly` rejects a display mismatch only when both context and item display ids are known. (`C/ItemFilter.swift:98–106`; `T/ItemFilterTests.swift:70–105`.)

Scopes:

- `allWindows`: filtered items.
- `activeApp`: with a known active pid keep its real windows; if none survive, take its first passing windowless entry from the original input (bypassing only `showWindowlessApps`); never synthesize. Unknown active pid → filtered list unchanged.
- `apps`: first surviving item per pid.

(`C/ItemFilter.swift:111–129`.)

### SearchMemory

Never serialized. Default capacity `256`, clamped ≥ 0; 0 disables. Ignore normalized-empty queries. Normalize: whitespace tokenization, the matcher's grapheme folding, join with one space. (`C/SearchMemory.swift:6,71–91,157–164`.)

Each `(normalizedQuery, itemID)` entry stores app key, pick count and last-used counter. App key = `"bundle:" + trimmedLowercaseBundleID` when non-empty, else `"name:" + foldedTrimmedAppName`. Each record increments the clock and count, updates app key and stamp, then evicts least-recently-used beyond capacity. Counts aren't reset when an existing tuple's app key changes. (`C/SearchMemory.swift:80–91,150–172`.)

For current query `C` and remembered `Q`, an entry applies only if one is a prefix of the other:

```text
relation = 50 + floor(50 × min(len(C), len(Q)) / max(len(C), len(Q)))
base     = 30 + 6 × max(0, min(count, 6) − 1)
age      = clock − lastUsed
recency  = max(30, 100 − 2 × age)
points   = floor(base × relation × recency / 10000)

windowTier = max points for exact item id AND same app key
appTier    = floor(max points for same app key / 2)
boost      = windowTier + appTier
```

Maxima, never sums. Max boost `90`. Same-app history survives new window/process identity; a reused window id from a different app gets no exact boost. (`C/SearchMemory.swift:102–147,166–172`.)

Only already-matching results are boosted; empty-query order never changes. The session reads a snapshot; a pick is recorded only when a searching session emits activation; cancel and actions don't record. (`C/SwitcherSession.swift:91–95,217–229`; `A/SwitcherCoordinator.swift:295–319`.)

## 3. Session input/effect table

`refresh` = redraw; unchanged or invalid selection → `none`. Indices zero-based. (`C/SwitcherSession.swift:243–258`.)

| Input / condition | State change | Effect |
|---|---|---|
| Open, default | Empty query; select second item, first if single, null if empty | Caller schedules presentation |
| Open with reverse trigger | Select last item | Caller schedules presentation |
| next / right | Index + 1 | `refresh` if changed |
| previous / left | Index − 1 | `refresh` if changed |
| Past edge, wrapping on | Positive modulo visible count | `refresh` if changed |
| Past edge, wrapping off | Clamp | `none` if unchanged |
| up/down in list | Same as previous/next | As above |
| up/down in grid | Move one row (rules below) | `refresh` if changed |
| first / last / select(index) | Select valid different index | `refresh`, else `none` |
| Navigation with empty results | — | `none` |
| type(text) | Drop newline graphemes and Tab; append; recompute selecting best | `refresh` |
| type: cleaned empty, or empty query and all-whitespace text | — | `none` |
| backspace with query | Delete one grapheme; preserve selected id unless query becomes empty | `refresh` |
| backspace with empty query | — | `none` |
| Escape with query | Clear query; opening selection rule; keep lock | `refresh` |
| Escape with empty query | — | `dismiss` |
| Space with empty search → lockOpen | Lock | `refresh` once, then `none` |
| triggerReleased, unlocked, selection | — | `activate(selected)` |
| triggerReleased, unlocked, no selection | — | `dismiss` |
| triggerReleased, locked | — | `none` |
| Enter/commit | — | `activate(selected)` or `dismiss` if empty |
| quickSelect(valid) (Later) | Set selection | `activate(item)` |
| quickSelect(invalid) | — | `none` |
| peek (Later) | — | `peek(item)` / `none` |
| action(focus) | — | `activate(selected)` |
| other action (Later) | — | `perform(action, item)` / `none` |

Sources: `C/SwitcherSession.swift:97–112,122–213,243–281`; reverse opening `A/SwitcherCoordinator.swift:233–250`.

Grid rows: `current ± columns` when valid. Down into a gap in a partial last row lands on the last item, even without wrapping. Down from the last row wraps to the same column of the first row when enabled. Up from the first row wraps to the same column of the last row, clamped to its final item if that column is absent. Otherwise non-wrapping edge moves do nothing. (`C/SwitcherSession.swift:261–280`.)

**Show delay belongs to the coordinator** (on Omarchy: `Switcher.qml`, TTO5). Build the session immediately; defer presentation by `showDelayMilliseconds` (default `90`). Release before presentation activates the preselection and cancels the show — no flash. A `refresh` effect before the delay shows the panel immediately; `none` does not. Locked sessions open with no delay; `releaseToSwitch: false` creates a locked session. (`A/SwitcherCoordinator.swift:162–165,233–254,273–285,295–312,488–498`.)

With grouping (Later), forward opening selects the second item of the filtered plain MRU order wherever it landed. (`A/SwitcherCoordinator.swift:242–249,473–483`.)

## 4. Configuration

Swift defaults (the source schema, not the Linux schema):

```json
{
  "version": 1,
  "triggers": [
    { "shortcut": "option+tab", "scope": "allWindows" },
    { "shortcut": "option+`", "scope": "activeApp" }
  ],
  "filters": {
    "showMinimized": true, "showHiddenApps": true, "showWindowlessApps": false,
    "currentSpaceOnly": false, "currentDisplayOnly": false, "currentDisplayFirst": false,
    "showOtherSpaces": false, "excludedBundleIDs": [], "pinnedBundleIDs": []
  },
  "appearance": {
    "style": "grid", "size": "medium", "showPreviews": false, "windowThumbnails": true,
    "showLargePreview": true, "largePreviewPercent": 66, "panelPosition": null, "previewPosition": null,
    "showAppName": true, "groupByApp": false, "showMenuBarIcon": true, "menuBarIconStyle": "classic",
    "theme": "system", "liquidGlass": true, "glassStyle": "clear",
    "colorTheme": { "preset": "none", "colors": ["#8c9bb5"], "intensity": 0.45, "grain": 0.15, "opacity": 0.55 },
    "placement": "mouse", "showDelayMilliseconds": 90, "animations": true
  },
  "behavior": {
    "releaseToSwitch": true, "searchEnabled": true, "startOnPrevious": true,
    "mouseHoverSelects": true, "wrapAround": true, "quickSelect": true, "checkForUpdates": false
  }
}
```

(`C/Configuration.swift:91–135,180–237`; `C/ItemFilter.swift:14–29`; `C/ColorTheme.swift:76–88`; `T/ConfigurationTests.swift:431–439`.)

Enums: scope `allWindows|activeApp|apps`; style `grid|list`; size `small|medium|large`; theme `system|light|dark`; placement `mouse|activeWindow|main`. (`C/ItemFilter.swift:3–11`; `C/Configuration.swift:37–89`.)

### Decode and validation contract

- Root must be an object. Missing/null/wrong-type fields and unknown enum values fall back individually; a wrong-type section falls back as a section. Unknown keys ignored. Arrays drop invalid elements and keep valid ones. (`C/Configuration.swift:229–237,309–328`; `T/ConfigurationTests.swift:79–119`.)
- A trigger needs a valid shortcut and scope; a bad style becomes absent without dropping the trigger. (`C/Configuration.swift:20–34,147–152`.)
- Shortcut parsing: split on `+`, trim, lowercase; last component is the key; repeated modifiers harmless; unknown modifiers/keys, empty components and trailing `+` fail. (`C/Shortcut.swift:23–28,57–76,155–168`.)
- At least one Command/Option/Control modifier (Linux: Super/Alt/Control); Shift or Fn alone is not enough. Keep the first duplicate shortcut; if none remain restore defaults. (`C/Configuration.swift:249–268`.)
- Clamp delay to `0…1000` and preview percent to `25…150`. (`C/Configuration.swift:244–247,270–281`.)
- Excluded/pinned id arrays: trim, drop empties, dedupe case-insensitively keeping first spelling. (`C/Configuration.swift:289–300`.)

The macOS `ConfigStore` (quarantining broken files, atomic 0600 saves, 300 ms debounced live reload) does not carry over: Omarchy owns `shell.json`. Keep its spirit — a bad setting never crashes the plugin and never destroys the user's data.

### Linux applicability

Names used by the port (`lib/Filter.js`, `lib/Settings.js`): `excludedAppIds`, `currentWorkspaceOnly`, `currentMonitorOnly`; the filter context is `{ activePID, ownPID, activeMonitor }`. TTO8 flattens the settings keys (see PLAN Deferred follow-ups).

Keep: `releaseToSwitch`, `searchEnabled`, `startOnPrevious`, `mouseHoverSelects`, `wrapAround`, `showDelayMilliseconds`, `style`, `size`, `showAppName`, `showMinimized`, previews (TTO7). Adapt: `currentSpaceOnly` → current workspace, `currentDisplayOnly` → current monitor, `bundleID` → app id. Drop: update checks, menu bar icon, Liquid Glass, glass style, theme (Omarchy's theme is used), positions and colour themes (Later).

## 5. Tests to port

Matcher examples use app name `"App"` unless stated.

| Area | Input → expected |
|---|---|
| Empty query | `""` or `"  \t "` → score 0, no indices. `T/FuzzyMatcherTests.swift:11–16` |
| Folding | `"cafe"` vs `"Café Menu"` → title highlights `"Café"`; `"ÜBER"` matches `"uber eats"`. `T/FuzzyMatcherTests.swift:26–34` |
| Multi-field tokens | `"chrome github"` vs app `"Google Chrome"`, title `"GitHub - Pull requests"` → app highlights `"Chrome"`, title `"GitHub"`; reversed tokens same. `T/FuzzyMatcherTests.swift:57–74` |
| Non-matches | `"cba"` vs app `"X"`, title `"abc"` → null; `"chrome zebra"` vs Chrome/GitHub → null. `T/FuzzyMatcherTests.swift:47–53` |
| Ranking | `"note"`: `"notes"` > `"nxoxtxe"`; `"port"`: `"my port"` > `"my report"`; `"mail"`: `"mail box"` > `"box mail"`. `T/FuzzyMatcherTests.swift:79–95` |
| Best occurrence | `"log"` vs `"blog - Log in"` → `[7,8,9]`. `T/FuzzyMatcherTests.swift:97–100` |
| Subsequence boundaries | `"gp"` vs `"Git Pull"` → `[0,4]`; `"ba"` vs `"xbya b"` → `[1,3]`. `T/FuzzyMatcherTests.swift:109–119` |
| Unicode offsets | `"photos"` vs `"👩‍👩‍👧 family photos"` → `[9,10,11,12,13,14]`. `T/FuzzyMatcherTests.swift:159–164` |
| Display-title fallback | Empty title, app `"Finder"`, `"fin"` → `"Fin"` highlighted in both labels. `T/FuzzyMatcherTests.swift:174–180` |
| Dual highlighting | `"slack"` vs app `"Slack"`, title `"Slack — general"` → both highlight Slack; `"mail"` vs app `"Mail"`, title `"my alpha in lab"` → app `[0,1,2,3]`, title `[]`. `T/FuzzyMatcherTests.swift:189–209` |
| MRU | `[1,2,3,4,5]`, touch `2,4,3` → `[3,4,2,1,5]`. `T/RecencyTrackerTests.swift:15–20` |
| Stable unknown order | `[4,1,5,3,2]`, touch `5` → `[5,4,1,3,2]`. `T/RecencyTrackerTests.swift:32–36` |
| Distinct id kinds | touch `app(1)`; `[window(1), app(1)]` → `[app(1), window(1)]`. `T/RecencyTrackerTests.swift:86–91` |
| Opening/cycling | Five items → index 1; next → 2; last, next → 0; previous → 4. Non-wrap edges → `none`. `T/SwitcherSessionTests.swift:24–45,62–81` |
| Grid gap | 7 items, 3 columns, index 5, down → 6; up → 3. 8 items, no wrap, index 5, down → 7; down → `none`. `T/SwitcherSessionTests.swift:169–188,213–220` |
| Search ranking | Titles `report draft`, `port`, `Unrelated`, app Editor; `"port"` → ids `[2,1]`; identical matches keep order. `T/SwitcherSessionTests.swift:260–275` |
| Backspace preservation | `alpha/alpine/albatross`; type `"al"`, `"b"`, delete → query `"al"`, selected albatross, index 2. `T/SwitcherSessionTests.swift:322–336` |
| Clear restoration | Type `"xc"`, delete twice → original list, empty query, index 1. `T/SwitcherSessionTests.swift:309–319` |
| No matches | Type `"qqqq"` → no selection; commit/release → dismiss. `T/SwitcherSessionTests.swift:278–284` |
| Escape and lock | Searching: Escape → clear/refresh; again → dismiss. Lock twice → refresh, none; release while locked → none; commit still activates. `T/SwitcherSessionTests.swift:451–488` |
| Live replacement | Selected id survives reorder → follows id; removed → keep/clamp position; empty → populated → opening selection. `T/SwitcherSessionTests.swift:535–565` |
| Routing | Grave trigger: Tab still cycles. Letter trigger `"a"` → next, not text. Forward Delete → deleteBackward. `T/KeyRouterTests.swift:21–32,61–64` |
| Trigger modifiers | Control-trigger + Control-S → type `"s"`; Option-trigger + extra Control-S → ignored. `T/KeyRouterTests.swift:147–157` |
| Space | Space without search → lock; during search → types a space. `T/KeyRouterTests.swift:68–97,182–194` |
| History exact values | One `"sl"` pick: same window 45, sibling 15; `"s"` or `"slac"` → 33; `"slack"` → 31. `T/SearchMemoryTests.swift:55–72` |
| History saturation | Eight repeated picks → `[45,54,63,72,81,90,90,90]`. `T/SearchMemoryTests.swift:157–167` |
| History age | One unrelated later pick → old exact boost 43; long aging → floor 13. `T/SearchMemoryTests.swift:170–178` |
| History normalization | `"  Ünïcödé   ＡＢ \n x "` → `"unicode ab x"`. `T/SearchMemoryTests.swift:102–105` |
| History identity/capacity | Same app, new window → app boost 15; reused id from a different app → 0; capacity 2, record `a,b,a,c` → evict `b`; capacity ≤ 0 → disabled. `T/SearchMemoryTests.swift:109–144,217–242` |
| History integration | Equal `"s"` matches Safari/Slack keep order; prior Slack pick for `"sl"` → Slack first. Boost never adds non-matches or changes empty-query order. `T/SwitcherSessionTests.swift:356–367,384–402` |
| Filter edge cases | Current-display-only, item displays `[1,2,null]`, active 1 → `[1,null]`; no active display → all. `T/ItemFilterTests.swift:97–105` |
| Scope fallback | Active app with only filtered-out minimized windows plus a windowless entry → windowless entry; exclusion/own pid still veto. Unknown active pid → normal list. `T/ItemFilterTests.swift:152–189` |
| Apps scope | First window filtered out → next surviving window represents the pid. `T/ItemFilterTests.swift:212–215` |
| Lenient config | `wrapAround: "yes", searchEnabled: false` → `true, false`; bad enum resets only that field; bad triggers dropped individually; non-object root rejected. `T/ConfigurationTests.swift:87–119` |
| Validation | Fn-only trigger → defaults; duplicate shortcut → first kept; delay `−50 → 0`, `5000 → 1000`; `["  com.a.App ","","com.b","COM.A.APP"]` → `["com.a.App","com.b"]`. `T/ConfigurationTests.swift:170–175,193–244` |

## 6. What makes it feel like TapTheTab

- **One continuous gesture:** hold, tap to open, keep cycling or type immediately, release to activate. The opening selection is the previous window. (`README.md:7,154–177`.)
- **Individual windows in MRU order**, kept current by live window changes. (`README.md:24–27,83–84,118–119`.)
- **Search without a mode:** title and app name, forgiving case and accents, highlighted hits, remembered picks — a bounded boost, not a guarantee. (`README.md:32–34,85–86`.)
- **Quick switch without a flash:** release inside 90 ms switches without showing the panel. (`README.md:90–91`.)
- **Predictable correction:** Backspace edits search; Escape clears first, dismisses second; Enter activates; Space locks an empty-search session open. (`README.md:156–177`.)
- **Same-app invocation** (Later) and **actions on the selection** (Later); mouse hover selects, click activates, outside click dismisses. (`README.md:87–89,167–179`.)
- **Privacy:** no telemetry; previews opt-in and memory-only.

Two README statements in the macOS repo are wrong: Fn alone is listed as a valid shortcut modifier but validation rejects it; one paragraph says preview size ends at 100 % while code allows 150 %. (`README.md:241–249,105–107`; `C/Configuration.swift:135–136,251–255`.)
