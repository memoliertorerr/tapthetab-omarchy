# TapTheTab for Omarchy — Build Plan

> A third-party Omarchy shell plugin that brings TapTheTab's window switching to Linux: hold Alt, tap Tab, see every window most recent first, type to fuzzy-search, release Alt to switch. Omarchy's own Alt+Tab only moves focus with no picker; this fills that gap. It is a new QML/JavaScript codebase — the Swift app (`../tapthetab`, macOS) is the behavioural reference, not shared code.
>
> **In scope for 0.1.0:** the plugin (manifest, overlay, pure-JS core), real hold-Alt/release-to-switch with the quick-tap shortcut, fuzzy search with highlighting, most-recently-used ordering, Omarchy theming, opt-in live window previews, a small settings surface, unit tests, an end-to-end test that boots a real Omarchy VM on GitHub Actions, and a release ready to submit to plugins.omarchy.org.
>
> **Explicitly NOT in scope** (designed, deferred — see **Later**): same-app switcher, group-by-app, pinning, quick-select digits, peek, window actions (close/minimize from the switcher), Arc-style gradient themes, translations, other compositors, an AUR package, and any PR to Omarchy itself.
>
> **The plugin never polls and never spawns processes while idle, and never edits the user's config files on its own.**
>
> **One step = one commit = one reviewable unit. The agent never commits or pushes** — it hands over a paired commit+push block and stops.

---

## Progress Tracker

> Each session flips its own row to ✅ as the final action of the step, in the same commit as the change. Read this table at the start of a session to know where to resume. (Status proposed by the session; the developer's commit is the real confirmation.)

| Step | Scope | Model | Status |
|------|-------|-------|--------|
| TTO0 | Scope docs, research, this plan; GitHub repo created | Opus 5.5 | ✅ done |
| TTO1 | Scaffold: manifest, minimal overlay, manifest test, unit CI | Opus 5.5 | ✅ done |
| TTO2 | End-to-end harness: boot Omarchy VM on Actions, install, summon, screenshot | Opus 5.5 | ✅ done |
| TTO3 | Port the core logic to pure JS (fuzzy, recency, session, keys, filter) + unit tests | GPT-6.1 Sol | ✅ done |
| TTO4 | Live windows, MRU tracking, search + Enter to switch (first usable build) | Opus 5.5 | ✅ done |
| TTO5 | Hold Alt / release to switch, quick tap, bindings snippet, real-key e2e | Opus 5.5 | ⬜ todo |
| TTO6 | Look and feel: list + grid, icons, highlights, theme, placement | Sonnet 5.5 | ⬜ todo |
| TTO7 | Opt-in live window previews | Opus 5.5 | ⬜ todo |
| TTO8 | Settings (inline plugin settings) | Sonnet 5.5 | ⬜ todo |
| TTO9 | Release 0.1.0: README, preview image, changelog, marketplace submission text | Sonnet 5.5 | ⬜ todo |

**Overall status: TTO0–TTO4 done; the switcher lists, searches and switches on real Omarchy 4.0.6 (summoned by command). TTO5 next: hold Alt, release to switch.** The sequence front-loads the two things everything depends on — a test harness that runs on a real Omarchy desktop (TTO2) and a correct core model (TTO3) — then reaches a usable switcher at TTO4, the real Alt-hold feel at TTO5, and polish after. TTO2 and TTO3 touch disjoint files and can run in parallel sessions; commit them separately.

**Model note:** Opus for the harness (TTO2: VM boot, SSH, QMP key injection — fiddly), the live-session wiring (TTO4) and the two spikes (TTO5 key release, TTO7 previews), where a wrong guess costs a CI round trip each time. GPT-6.1 Sol for the core port (TTO3): a precise, self-contained translation job with a written spec and test vectors, and a second model family cross-checks Claude's reading of the Swift code. Sonnet for scaffolding-shaped and documentation work. **TTO5 is the step most likely to become a spike** — whether Qt sees Alt's release on a layer surface that grabbed focus while Alt was held is unproven.

**Session split** — natural review checkpoints:
1. **TTO1 → TTO3** — foundations. Review: CI green on GitHub (both jobs), core tests mirror the Swift tests.
2. **TTO4 → TTO5** — it works. Review: try it in your own Omarchy VM; this is where the feel is judged.
3. **TTO6 → TTO9** — polish and ship. Review: screenshots, README, submit to the marketplace.

One session can carry several steps back-to-back; the phases are suggested checkpoints. Never start a step with uncommitted changes in the tree.

---

## How To Run This

1. Open a **new session** in `/Users/memoli/Storage/CS/TapTheTab/tapthetab-omarchy`. `AGENTS.md` (via `CLAUDE.md`) auto-loads.
2. **Paste the Opening prompt below first.** Wait for its green light.
3. Paste the **PROMPT** for the next unfinished step.
4. The session does the work, runs `node --test`, ticks its tracker row, and shows a diff + a paired commit+push block. **It never commits.**
5. You review, commit and push. The push runs CI on GitHub; the next session (or this one) reads the result with `gh run list` / `gh run view` before building on it.

### Opening prompt — every step

```text
You are building TapTheTab for Omarchy, a third-party Omarchy desktop (Quickshell/QML) plugin that is a keyboard-first, search-first window switcher for Hyprland, in /Users/memoli/Storage/CS/TapTheTab/tapthetab-omarchy.
Before any work:
1. Read AGENTS.md and docs/PLAN.md in this repo, in full. Skim docs/research/*.md; read the parts your step names.
2. Run `git status` and `git branch --show-current`. Confirm the tree is clean and the branch is main. If the repo has no commits yet, tell me the commands from "0. Before Starting" and STOP until I've run them.
3. Run `gh run list --limit 5` and tell me whether the latest CI run on main is green. If it is red, say which job failed and STOP — we fix main before building on it.
4. Restate, in one line each, the rules you will not break this session:
   (a) you never run `git commit` or `git push` — you hand me a paired block and stop;
   (b) the plugin never polls and never spawns a process while idle;
   (c) you never claim to have verified something only a live Omarchy desktop or my eyes can verify.
5. Read the Progress Tracker and tell me which step is next (the first ⬜ todo).
Then wait. Do not implement anything until I paste the step prompt.
```

### Who verifies what

| Check | Who | "Green" looks like |
|---|---|---|
| `node --test` | Agent (macOS, locally) | All unit tests pass; the core model matches the Swift app's tested behaviour |
| Unit CI job (`.github/workflows/ci.yml`) | GitHub, after your push; agent reads it with `gh run view` | Green |
| VM e2e job (`.github/workflows/vm.yml`) | GitHub, after your push; agent reads logs and downloads screenshots with `gh run download` | Green; `omarchy plugin validate` passes; scenario assertions pass; screenshots attached |
| `qmllint` | VM e2e job (needs Omarchy's `shell/` on the import path) | No errors for the plugin's QML |
| **Nothing regressed** | VM e2e job + you | Earlier scenarios still pass; the plugin disabled leaves Omarchy's own Alt+Tab working; no process spawned while idle |
| The feel: latency, hold/release, quick tap | **you**, in your Omarchy VM | Holding Alt+Tab shows the panel after ~90 ms, release switches, a quick tap swaps to the previous window with no flash |
| Visuals: layout, theme colours, fonts, previews | **you**, in your VM; CI screenshots help but are a single theme and resolution | Looks native to Omarchy in two different themes |

The agent can run the unit tests on this Mac and read CI results. It cannot run Omarchy, see the screen, or press keys. Every step's summary says which checks the agent ran, which ran in CI, and which are yours.

---

## Ground Rules

1. **Branch:** `main`. Solo project; CI runs on every push. Tag `tto-plan` after TTO0.
2. **One step = one commit**, message prefixed `tto-step-N:`.
3. **Verify before every commit.** `node --test` must be green locally. Never hand over a commit on a red tree. When the step touches QML or CI, say plainly that the VM job is the real check and it runs after the push.
4. **The agent never commits or pushes** — paired commit+push block, then stop.
5. **No polling, no idle processes.** React to Hyprland raw events (`activewindowv2`, `openwindow`, `closewindow`, `movewindowv2`) and Quickshell signals. No `Timer` that starts a `Process`, ever. Any timer runs only while the switcher is open. Omarchy fails a shell that spawns a process during 30 idle seconds; we hold ourselves to the same bar.
6. **Logic lives in pure JS** under `lib/`, ES5 style (`var`, `function`) to match Omarchy, ending in `if (typeof module !== "undefined") module.exports = {...}`. QML imports it; `node --test` tests it. QML files hold wiring and visuals only.
7. **Follow Omarchy's shell rules** (summarised in `docs/research/omarchy-plugin-api.md` §7): entry is an `Item` with `open(payloadJson)`, `close()`, `opened`; `import qs.Commons as Commons` for colours and fonts; **no open/close animation** (pickers summoned by a keystroke never animate); every duration through `Style.duration(ms)`, easing `Style.easeOut`, nothing over 300 ms.
8. **Target stable Omarchy, not the development branch.** Users run the current stable release, which is also what the CI VM boots (4.0.6 on 2026-10-31). Before using any Omarchy shell API, check it exists at that release tag: `gh api "repos/omacom/omarchy/contents/<path>?ref=v4.0.6" --jq .content | base64 -d`. The local checkout at `/Users/memoli/Downloads/omarchy-quattro` is the `quattro` development branch and has APIs stable lacks (`qs.Ui` `OverlayWindow` and `FilterInput`, `qs.Commons` `ShellIpc`, `o.bind_hold`).
9. **Privacy, as on macOS:** no network access, no telemetry, nothing written outside the plugin's own settings entry.
10. **Never touch the user's config automatically.** Keybindings are a snippet the user pastes into `~/.config/hypr/bindings.lua` (the README says how). `omarchy plugin add` runs no hooks, and we don't work around that.
11. **Plugin id is `memoliertorerr.tapthetab`, forever.** Global shortcut appid and IPC target are `tapthetab`. Changing them breaks every user's bindings.
12. **Every step:** ask questions if genuinely uncertain, and update `AGENTS.md` (file structure, conventions), `README.md` (user-facing behaviour) and this plan (tracker, implementation notes, landmines).

### Rollback

| Situation | Command |
|---|---|
| Step wrong, uncommitted | `git restore . && git clean -fd` (run `git status` first and check what would be lost) |
| A committed step is bad | `git revert <sha>` then push |
| Abandon back to the plan | `git reset --hard tto-plan` (rewrites history — only before anyone else has cloned) |

---

## 0. Before Starting

Done in TTO0. For the record, the developer ran:

```bash
cd /Users/memoli/Storage/CS/TapTheTab/tapthetab-omarchy
git add AGENTS.md CLAUDE.md docs/
git commit -m "tto-step-0: scope docs, research and build plan"
git tag tto-plan
gh repo create memoliertorerr/tapthetab-omarchy --public --source . --remote origin --description "TapTheTab for Omarchy: a keyboard-first, search-first window switcher plugin for the Omarchy desktop"
git push -u origin main --tags
```

---

## Design Decisions Already Made

- **A third-party Omarchy shell plugin, not a standalone app.** Installed with `omarchy plugin add`, listed on plugins.omarchy.org. Omarchy-only by design; other Hyprland setups are Later. Do not redesign this mid-plan; if a step seems to require changing it, STOP and raise it.
- **New repo, no shared code with the Swift app.** `../tapthetab` is the behavioural reference. `docs/research/port-spec.md` is the written contract for the port; when it and the Swift code disagree, the Swift code and its tests win and the spec gets fixed.
- **Kinds `overlay`, with `keepLoaded: true`.** One entry, `Switcher.qml`. `keepLoaded` keeps the global shortcuts, IPC target and MRU tracker alive before the first summon. Split out a `service` kind only if TTO5 proves it necessary.
- **Our own MRU list.** Tracked from `activewindowv2` raw events, seeded once from `focusHistoryID` after a single `Hyprland.refreshToplevels()`. `lastIpcObject` is stale between refreshes, so never read order from it on open.
- **Focus in-process.** `Hyprland.dispatch(...)` with `hl.dsp.focus` + `hl.dsp.window.alter_zorder`, in the syntax stable Omarchy's `bin/` scripts use (`omarchy-hyprland-focus-app`, `omarchy-hyprland-window-pop`); minimized windows (special workspaces) are brought to the active workspace first, like the development branch's dock `bringForward` (stable 4.0.6 has no dock). No `hyprctl` process per switch.
- **Release detection: Qt first, Hyprland fallback, both idempotent.** TTO5 spikes `Keys.onReleased` on the exclusive-focus overlay; the fallback is a Hyprland release bind on `ALT + Alt_L` (`{ release = true, transparent = true, ignore_mods = true, non_consuming = true }`) dispatching `hl.dsp.global("tapthetab:commit")`. A commit that arrives twice does nothing the second time.
- **Settings are inline plugin settings** in the plugin's `plugins[]` entry in `~/.config/omarchy/shell.json`, written through `shell.updateEntryInline`. Not a separate JSON file: this is how Omarchy plugins persist settings.
- **CI reuses Omarchy's VM approach.** Omarchy boots its stable VM image under KVM on GitHub's `ubuntu-26.04` runners (`.github/workflows/test.yml` and `test/ci-vm` in the Omarchy repo, MIT). We adapt that script (with attribution), add a QMP socket so scenarios can press real keys, and run our scenarios from the host side.

---

## Steps

### TTO1 — Scaffold · Opus 5.5

**Verify:** `node --test` passes locally (manifest test). After push: the `ci` workflow is green on GitHub. `manifest.json` satisfies every rule in `docs/research/omarchy-plugin-api.md` §1.
**Commit:** `tto-step-1: scaffold the plugin, manifest test and unit CI`

```text
Step TTO1: scaffold the plugin. Read AGENTS.md, docs/PLAN.md (Ground Rules, Design Decisions) and docs/research/omarchy-plugin-api.md §1, §2, §7 first.

Create:
- manifest.json: schemaVersion 1, id "memoliertorerr.tapthetab", name "TapTheTab", version "0.0.1", author, description, license "MIT", kinds ["overlay"], keepLoaded true, entryPoints {"overlay": "Switcher.qml"}.
- Switcher.qml: the smallest real overlay. An Item exposing `property bool opened`, `function open(payloadJson)`, `function close()`, and the injected properties it uses (`shell`, `manifest`). It shows a qs.Ui OverlayWindow (WlrLayershell.namespace "tapthetab", exclusive keyboard) with a centred panel listing the titles of Hyprland.toplevels (Quickshell.Hyprland), themed with Commons.Color.menu.* and Style.font.menuFamily. Escape calls shell.hide(manifest.id). Follow Emojis.qml's focus pattern described in the research doc (keyCatcher.forceActiveFocus() in open(), Keys.priority BeforeItem). No search, no MRU, no switching yet — those are TTO3/TTO4, kept out so this diff stays a skeleton.
- lib/.gitkeep (the pure-JS core arrives in TTO3).
- tests/manifest.test.js (node:test, no dependencies): mirrors the validator rules from the research doc — required fields, schemaVersion 1, id regex ^[A-Za-z0-9][A-Za-z0-9._-]*$, not starting with "omarchy.", every kind has its entry key, every entry point is a relative path without ".." and exists on disk, no symlinks in the repo outside .git. It must fail if you break any one of those (try one, then restore).
- .github/workflows/ci.yml: on push, pull_request and workflow_dispatch; ubuntu-latest; actions/setup-node with Node 24; `node --test`. Pin actions by commit SHA with the version in a comment, as Omarchy's workflows do.
- README.md: one-paragraph description, a clear "work in progress, not usable yet" note, and the install command `omarchy plugin add https://github.com/memoliertorerr/tapthetab-omarchy.git` marked as future.
- LICENSE: MIT, same copyright holder as ../tapthetab/LICENSE (read it).
- .gitignore: node_modules, .DS_Store, out/.

You cannot run QML here (macOS, no Quickshell). Say so in your summary: Switcher.qml is unverified until TTO2's VM job loads it. Keep it small and close to the patterns in the research doc so it is likely to load first time. If something in the research doc looks wrong or ambiguous for Switcher.qml, ask rather than guess.

Update AGENTS.md's file-structure section. Run `node --test`. Flip TTO1 to ✅ in docs/PLAN.md in the same change, then show me the diff and a single block with BOTH the git commit ("tto-step-1: scaffold the plugin, manifest test and unit CI") AND git push. Do not commit.
```


**Implementation notes (2026-10-30):**

- Built by the orchestrating session in parallel with TTO2 and TTO3, so the three steps landed in one batch of commits.
- `Switcher.qml` follows Omarchy's emoji picker (`BorderSurface`, key catcher with `Keys.priority: Keys.BeforeItem`). It first used `qs.Ui` `OverlayWindow`, which exists only on Omarchy's development branch; the first VM run failed with `OverlayWindow is not a type`, and it now builds a plain `PanelWindow` like stable 4.0.6's emoji picker. Every `Style.*` token it uses was then re-checked against v4.0.6.
- `tests/manifest.test.js` was checked to fail on a reserved `omarchy.` id and pass on the real one.
- **Not verified by the session that built it:** whether `Switcher.qml` loads. The first `vm` run is its first real test.

---

### TTO2 — End-to-end harness on a real Omarchy VM · Opus 5.5

**Verify:** after push, the `vm` workflow is green: the VM boots, `omarchy plugin validate` passes, `omarchy plugin add <checkout> --yes --enable` installs it, summoning maps a layer with namespace `tapthetab`, a screenshot of the open switcher is uploaded as an artifact, hiding unmaps it, and `qmllint` reports no errors. The agent pastes the run URL and the screenshot path from `gh run download`.
**Commit:** `tto-step-2: boot an Omarchy VM in CI and drive the plugin end to end`

```text
Step TTO2: build the end-to-end harness. Read AGENTS.md, docs/PLAN.md and docs/research/omarchy-plugin-api.md §6 first. Then read Omarchy's own CI, which we are adapting: /Users/memoli/Downloads/omarchy-quattro/.github/workflows/test.yml and /Users/memoli/Downloads/omarchy-quattro/test/ci-vm (read-only — never edit anything in that directory). Omarchy is MIT; keep an attribution comment at the top of the adapted script.

Build:
- ci/vm-boot: adapted from test/ci-vm. Creates a throwaway overlay disk on the stable image, boots it under KVM with a per-run SSH key passed as a systemd credential, waits for SSH and for HYPRLAND_INSTANCE_SIGNATURE in the user manager, sets stay-awake, copies this checkout (with .git) to ~/src/tapthetab-omarchy. Add `-qmp unix:$state/qmp.sock,server=on,wait=off` so scenarios can press real keys later (TTO5).
- ci/lib.sh, sourced by scenarios on the host side: ssh_vm, in_session (run a command in the desktop session via systemd-run --user, like test/ci-vm does), wait_layer <namespace> mapped|absent (poll `hyprctl -j layers` inside the VM, with a timeout — polling is fine in tests, never in the plugin), screenshot <name> (grim inside the VM, copied to out/screenshots/), open_window <title> (start a terminal with a known title through Hyprland; find the right Omarchy command — xdg-terminal-exec or hyprctl dispatch of hl.dsp.exec_cmd — and wait until hyprctl clients shows it), active_title, and qmp_key down|up <qcode> plus qmp_tap <qcode> (QMP input-send-event; use socat or python3 from the container, whichever is available — install it in the workflow if needed).
- ci/scenarios/01-install-and-summon.sh: omarchy plugin validate ~/src/tapthetab-omarchy; omarchy plugin add ~/src/tapthetab-omarchy --yes --enable; open three windows titled tto-a, tto-b, tto-c; `omarchy-shell shell summon memoliertorerr.tapthetab '{}'`; wait_layer tapthetab mapped; screenshot 01-open; `omarchy-shell shell hide memoliertorerr.tapthetab`; wait_layer tapthetab absent. Also run qmllint on the plugin's QML with -I pointing at the VM's Omarchy shell directory ($OMARCHY_PATH/shell) and fail on errors.
- ci/run-scenarios: boots once, runs every ci/scenarios/*.sh in order, collects `qs log -p "$OMARCHY_PATH/shell"` tail and `journalctl --user` tail into out/ on failure, exits non-zero if any scenario failed.
- .github/workflows/vm.yml: modelled on Omarchy's test.yml (fetch the image from https://nightly.omarchy.org/stable/latest.json with aria2c into /dev/shm, verify sha256, run inside ghcr.io/archlinux/archlinux:latest with /dev/kvm, the pacman Landlock workaround and retry loop), then ci/run-scenarios; always upload out/ as an artifact. Triggers: push, pull_request, workflow_dispatch. Pin actions by SHA like Omarchy does.

The plugin must be installed through `omarchy plugin add` — that is what users do, and it validates the manifest the way the shell will. Do not copy files into ~/.config/omarchy/plugins by hand.

You cannot run any of this locally; the first real run is after my push. Before handing over: run `bash -n` on every script, and `node --test`. Write in your summary exactly what will happen on the first run and which parts are most likely to need a second iteration (image layout, terminal command, grim availability). After I push, read the run with `gh run watch` / `gh run view --log-failed`, fix what broke, and hand me a follow-up commit block (same prefix, "fix:" suffix) — iterate until green, then paste the run URL and `gh run download` the screenshot.

Update AGENTS.md (how to run CI, how scenarios work) and add any real friction to Landmines in docs/PLAN.md. Run `node --test`. Flip TTO2 to ✅ in docs/PLAN.md in the same change, then show me the diff and a single block with BOTH the git commit ("tto-step-2: boot an Omarchy VM in CI and drive the plugin end to end") AND git push. Do not commit.
```


**Implementation notes (2026-10-30):**

- Written by a Claude Opus subagent. Checked locally only: `bash -n` on every script, the workflow YAML parses, the host → ssh → `systemd-run` → `bash -c` quoting was exercised against a stubbed ssh. shellcheck was not available.
- Differences from the prompt: `ci/vm-boot` also waits for `omarchy-shell shell ping` (the shell starts after the compositor); qmllint fails the scenario only on `critical`/`fatal` findings and reports warnings in `out/qmllint.txt`; checkout uses `fetch-depth: 0` rather than proving `omarchy plugin add` works from a shallow clone; `push` runs only on `main`, like Omarchy's workflow.
- Windows are foot terminals started with `uwsm-app -- xdg-terminal-exec --title=…`.
- **Most likely first-run failures:** the qmllint binary name and its `--json` layout (written from memory); the session environment (`OMARCHY_PATH`, `PATH`, `WAYLAND_DISPLAY` in the user manager); foot honouring `--title`; `Switcher.qml` failing to load (read `out/shell.log`).

**First runs (2026-10-31):** three fix commits to green. Run 1 failed on `OverlayWindow is not a type` (development-branch API; now a `PanelWindow`). Runs 1–2 linted nothing because `systemd-run` expanded `${...}` (see Landmines). Run [41199136595](https://github.com/memoliertorerr/tapthetab-omarchy/actions/runs/41199136595) is green: qmllint 6.12 checks `Switcher.qml` with no errors, the screenshot shows the overlay listing tto-a/b/c, the job takes about 55 s. The session environment, foot's `--title` and the qmllint `--json` layout all worked as written.
- qmllint warnings to expect: `Member "…" not found on type "QObject"` for every `Color.menu.*` / `Style.*` token (Omarchy's singletons are typed as plain objects, so qmllint can't see their members) and `PanelWindow is not creatable` — both false positives. `Unqualified access` inside a delegate and `var` in block scope are real style warnings; TTO4's rewrite of the list should clear them.

---

### TTO3 — Port the core logic to pure JS · GPT-6.1 Sol

**Verify:** `node --test` passes. Every behaviour in `docs/research/port-spec.md` §2–3 has a test, and the fuzzy-ranking test vectors ported from `../tapthetab/Tests/TapTheTabCoreTests` produce the same order as the Swift app. No QML changed.
**Commit:** `tto-step-3: port the switcher core to pure JavaScript`

```text
Step TTO3: port TapTheTab's platform-independent core to pure JavaScript. Read AGENTS.md, docs/PLAN.md, and docs/research/port-spec.md in full. The Swift source of truth is ../tapthetab/Sources/TapTheTabCore and ../tapthetab/Tests/TapTheTabCoreTests (read-only — never edit that repo).

Write, under lib/, ES5-style modules (var, function, no classes, no arrow functions, no let/const at top level — Quickshell's QML engine and Omarchy's style), each ending with `if (typeof module !== "undefined") module.exports = {...}`:
- lib/Fuzzy.js — the FuzzyMatcher: tokenisation, case and accent folding, title + app-name scoring, match indices for highlighting, tie-breaks. Same ranking as Swift.
- lib/Recency.js — MRU ordering from focus stamps; unknown items keep their platform order.
- lib/Filter.js — ItemFilter (include minimized, hidden, scope) without reordering.
- lib/Session.js — the SwitcherSession state machine: items, query, ranked visible items, selection, wrap-around, empty results; `handle(state, input)` returns `{ state, effect }` with effects refresh / activate(item) / dismiss. Pure: no timers, no clocks — time comes in as input.
- lib/Keys.js — KeyRouter: maps a key event description `{ key, text, modifiers }` to a session input (cycle forward/back, arrows, typing, backspace, escape, enter).
- lib/SearchMemory.js — only if port-spec.md marks it MVP.
Items are plain objects: `{ id, title, appName, appId, workspace, minimized, focusStamp }` — document the shape at the top of Session.js.

Tests: tests/<module>.test.js with node:test and node:assert, no dependencies. Port the Swift test cases named in port-spec.md as input → expected output pairs, plus the state table from §3. Where the Swift app has macOS-specific behaviour (Spaces, Wine names, ⌘ shortcuts), drop it and say so in the module header; Alt replaces ⌥ and Super is not used.

Do NOT touch Switcher.qml or anything under ci/ — wiring is TTO4, kept separate so this diff is reviewable as a pure port. If the spec and the Swift code disagree, follow the Swift code and its tests, fix port-spec.md in the same change, and tell me.

Update AGENTS.md (lib/ module map). Run `node --test` and paste the summary line. Flip TTO3 to ✅ in docs/PLAN.md in the same change, then show me the diff and a single block with BOTH the git commit ("tto-step-3: port the switcher core to pure JavaScript") AND git push. Do not commit.
```


**Implementation notes (2026-10-30):**

- Ported by GPT-6.1 Sol (30 tests, correct but written like minified code), then rewritten for readability and independently reviewed by Claude Sonnet 5.5 (139 tests). Finally 140 tests.
- **Bug found in review:** `Graphemes.split` joined any character after a zero-width joiner, which would have broken highlights and Backspace for Indic and Arabic titles. It now joins only emoji after a ZWJ; a test catches the old rule.
- **Gap found in review:** the "a title/app tie chooses the title" rule (port-spec §2 step 7) had no test; one was added and checked against a `>=` mutation. About 20 hand-made mutations were run; all are caught except removing the explicit tie-break in `Recency.ordered`, which Node's stable sort hides. It stays, because QV4's sort stability is unknown.
- **Decision:** stroked letters (ł, ø, đ, ħ, ŧ, ı) fold to their plain letter on both engine paths, so "lodz" finds "Łódź". Before, the result depended on whether the engine had `String.prototype.normalize`. A test runs both paths.
- Every lib module starts with `.pragma library`, as Omarchy's do. `tests/helpers/qml-loader.js` loads modules either as CommonJS or the way QML does (aliases from `.import`); each module with imports has a test through the QML path.
- `lib/Settings.js` decodes a nested schema; TTO8 reshapes it to flat keys (see Deferred follow-ups).
- Window actions and peek are routed only when `actionsEnabled` / `peekEnabled` are passed to `Keys.route`; by default Shift+letter types into the search, since actions are Later.
- **Not verified:** that QV4 loads these modules. TTO4's VM run is the first check.

---

### TTO4 — Live windows, MRU, search and switching · Opus 5.5

**Verify:** `node --test` passes (new `lib/Windows.js` tests). VM job green with a new scenario: open tto-a, tto-b, tto-c in that order; summon; the list order is tto-c, tto-b, tto-a (MRU); typing `tto-a` narrows to one row; Enter focuses it (`active_title` is tto-a); the layer unmaps; summoning again after focusing tto-b shows tto-b first. Screenshots of the full list and the filtered list are uploaded. The idle check (no process started by the shell in 30 s with the plugin enabled) passes.
**Commit:** `tto-step-4: live window list, MRU order, search and switching`

```text
Step TTO4: make the switcher real, opened by a summon (hold-Alt comes in TTO5). Read AGENTS.md, docs/PLAN.md (Design Decisions: MRU, focus in-process), docs/research/omarchy-plugin-api.md §4 and §7, and lib/*.js from TTO3.

Build:
- lib/Windows.js (pure, tested): turn Hyprland toplevel snapshots into Items (skip entries with no appId or with a parent, as Omarchy's dock does; mark windows on special/minimized workspaces as minimized), merge with the MRU list, handle windows opening/closing between summons.
- In Switcher.qml: an MRU tracker driven by Hyprland.onRawEvent (activewindowv2 → move address to front; openwindow; closewindow → remove), seeded once at load from focusHistoryID after a single Hyprland.refreshToplevels(). No timers. On open(): build items, create a Session, render the ranked list, focus the key catcher. Typing filters (use the Util.editsFilter / Util.editedFilter helpers from qs.Commons, as stable Omarchy's emoji picker does; qs.Ui FilterInput is development-branch only); arrows/Tab/Shift+Tab move the selection; Enter or click activates; Escape dismisses.
- Activation: Hyprland.dispatch with hl.dsp.focus + hl.dsp.window.alter_zorder({ mode = "top" }) on the window address; bring minimized windows to the active workspace first, mirroring Omarchy's dock bringForward (/Users/memoli/Downloads/omarchy-quattro/shell/plugins/dock/Dock.qml:186-214, read-only). Close the overlay before focusing so focus lands on the window, not back on the layer.
- ci/scenarios/02-mru-search-switch.sh as described in this step's Verify line, plus an idle check modelled on Omarchy's test/shell.d/shell-idle-spawn-test.sh (read it; adapt the idea, don't copy the whole harness).

Keep the visuals plain — a themed list of app name + title. Layout, icons, highlights and grid are TTO6; do not start them here.

Run `node --test`. You cannot see the result; CI is the check. After my push, read the vm run, iterate with fix commits until green, and paste the run URL and screenshots. Then tell me this is the first build worth trying in my own VM, with the exact commands to install it there and a summon command to bind temporarily (e.g. a Super+period binding that runs `omarchy-shell shell toggle memoliertorerr.tapthetab '{}'`).

Update AGENTS.md and README.md (what works now). Flip TTO4 to ✅ in docs/PLAN.md in the same change, then show me the diff and a single block with BOTH the git commit ("tto-step-4: live window list, MRU order, search and switching") AND git push. Do not commit.
```

**Implementation notes (2026-10-31):**

- Built by a Claude Opus subagent, reviewed by GPT-6.1 Sol; the review's four findings were fixed before the first push. 163 unit tests. Nothing has run in QML yet: the first `vm` run is the check.
- **Plan assumptions that didn't hold on stable 4.0.6:** there is no dock plugin (dispatch syntax comes from `bin/` scripts instead) and no `test/shell.d/shell-idle-spawn-test.sh` (the idea comes from the development branch). Stable's own shell starts processes while idle, so `03-idle-no-spawn.sh` runs a second shell that loads only the installed `Switcher.qml` and watches that one: no new process in its cgroup, and no change in its reaped-children fault counters, for 30 s while focus moves and a window opens and closes.
- **Focus after Enter:** Hyprland refuses window focus while an exclusive-keyboard layer is mapped (confirmed in Hyprland 0.56.2's `FocusState.cpp`), so the overlay closes, dispatches focus at once, and dispatches again on its own `closelayer>>tapthetab`. Only that event, or the chosen window getting focus, ends the wait. Most likely first-run failure.
- **Review fixes:** ordinary named workspaces have negative ids too (from -1337 down), so "special" is decided by name, and a minimized window moves to a named active workspace as `name:<name>` (only for plain names); title changes and late Wayland handles rebuild an open list (an `Instantiator` over the toplevels, active only while open); the idle scenario fails if its event driver can't open and close its window.
- **Debug IPC:** `IpcHandler { target: "tapthetab" }` with a read-only `state()`; scenarios read it through `switcher '<jq>'` in `ci/lib.sh`. TTO5's verbs join the same target.
- MRU seeding from `focusHistoryID` is lazy, at the first `open()`, from the one load-time `refreshToplevels()` (nothing signals when that refresh lands, and a timer isn't allowed). Until a window gets focus, the app id falls back to Hyprland's `class`.
- Lib aliases in QML are `KeyRouter` and `ItemFilter`: importing `lib/Keys.js` as `Keys` would shadow QML's attached `Keys`.
- **First run green (2026-10-31):** [run 41231912102](https://github.com/memoliertorerr/tapthetab-omarchy/actions/runs/41231912102) passed all three scenarios with no fix commits. Rows came out `tto-c,tto-b,tto-a`; typing `tto-a` with real QMP keys left one row; Enter unmapped the layer and focused tto-a; after focusing tto-b the order was `tto-b,tto-a,tto-c`; the plugin-only shell started nothing in 30 s while windows opened, closed and took focus. qmllint shows only the known false positives. Screenshots are in `docs/images/` and the README.
- **Still not verified:** moving a minimized window (`hl.dsp.window.move` with `window` and `workspace` together, and the `name:` selector) — no scenario minimizes a window yet; a real keyboard and the feel, on the developer's machine.

---

### TTO5 — Hold Alt, release to switch · Opus 5.5

**Verify:** VM job green with real keys via QMP: (1) Alt down, Tab, wait 300 ms, screenshot (panel visible, second MRU window selected), Alt up → that window is active and the layer is gone; (2) Alt down, Tab, Alt up within 50 ms → previous window active and the layer was never mapped; (3) Alt down, Tab, Tab, Shift+Tab, Alt up → second MRU window; (4) Alt down, Tab, type `tto-a`, Alt up → tto-a; (5) Alt down, Tab, Escape, Alt up → focus unchanged. Implementation notes record which release path works (Qt or the Hyprland bind) — evidence, not a guess.
**Commit:** `tto-step-5: hold Alt and release to switch, with the quick tap`

```text
Step TTO5: the core feel — hold Alt, tap Tab, release to switch. This is a spike first, then an implementation. Read AGENTS.md, docs/PLAN.md (Design Decisions: release detection), docs/research/omarchy-plugin-api.md §2–§3, and docs/research/port-spec.md (show delay, quick tap).

1. Global shortcuts: in Switcher.qml (keepLoaded), declare Quickshell.Hyprland GlobalShortcut objects with appid "tapthetab": next, prev, commit, cancel. Also a Quickshell IpcHandler with target "tapthetab" and the same verbs, for testing and for users who prefer exec binds (qs.Commons ShellIpc does not exist in stable Omarchy 4.0.x).
2. Spike, with evidence: does the exclusive-keyboard OverlayWindow receive Keys.onReleased for Alt (or a modifiers change dropping Alt) when it was mapped while Alt was already held? Add a temporary scenario that logs what arrives (console.info into the shell log, read via `qs log`) and report the result before building on it. Write the finding into the Implementation notes either way.
3. Implement: `next` while closed opens a session with the second MRU window pre-selected and starts a show timer (default 90 ms, from port-spec.md); the overlay window stays unmapped (or fully transparent with no visible frame — check what OverlayWindow allows) until the timer fires. `commit` before the timer → activate the pre-selected window with no flash. `commit` after → activate the selection. Commit is idempotent (Qt release and the Hyprland bind may both fire). Timers exist only while a session is active.
4. Bindings: add extras/bindings.lua — the snippet users paste into ~/.config/hypr/bindings.lua: unbind Omarchy's ALT+TAB and ALT+SHIFT+TAB (four binds on two chords, default/hypr/bindings/tiling.lua:55-58 in the Omarchy repo), bind them to hl.dsp.global("tapthetab:next"/"prev"), and add the Alt release bind on "ALT + Alt_L" with { release = true, transparent = true, ignore_mods = true, non_consuming = true } if the spike says we need it. In CI, apply that snippet to the VM user's bindings.lua (CI is not a user's machine — that's fine there) and verify both chords are really unbound (hl.unbind behaviour is unverified).
5. ci/scenarios/03-hold-release.sh with the five QMP cases from the Verify line.

If neither release path works reliably, STOP and tell me what you observed, with logs; do not ship a half-working hold mode. Do not touch layout or visuals (TTO6).

Run `node --test`. After my push, iterate on CI with fix commits until green; paste the run URL. Then tell me exactly what to try in my VM to judge the feel (it's my check, not yours).

Update README.md (setup: paste the snippet; how to undo it), AGENTS.md and Landmines. Flip TTO5 to ✅ in docs/PLAN.md in the same change, then show me the diff and a single block with BOTH the git commit ("tto-step-5: hold Alt and release to switch, with the quick tap") AND git push. Do not commit.
```

---

### TTO6 — Look and feel · Sonnet 5.5

**Verify:** `node --test` passes (layout math in `lib/Layout.js` is tested). VM job green; screenshots of list and grid layouts, with a search highlight, uploaded under two Omarchy themes (switch with `omarchy-theme-set` in the scenario). No open/close animation; any selection motion uses `Style.duration` and `Style.easeOut`.
**Commit:** `tto-step-6: list and grid layouts, icons, highlights and theming`

```text
Step TTO6: make it look like it belongs in Omarchy and like TapTheTab. Read AGENTS.md, docs/PLAN.md, docs/research/omarchy-plugin-api.md §1 (theme tokens) and §7 (motion), and ../tapthetab/docs/ARCHITECTURE.md (GridLayout, PanelLayout) plus ../tapthetab/README.md's screenshots description for the target look.

Build: lib/Layout.js (pure, tested: grid columns/rows/scale for a screen size, list height capped at 10 rows, as the Swift GridLayout/PanelLayout do); a list layout (icon, app name, title, highlighted match characters from lib/Fuzzy.js indices) and a grid layout (icon cards); app icons via DesktopEntries.heuristicLookup(appId) + Quickshell.iconPath; Commons.Color.menu.* tokens and a qs.Ui BorderSurface; the panel on the monitor with the focused window; a search field that appears once typing starts. Layout choice is a constant for now — settings are TTO8.

Follow agents/skills/motion.md in the Omarchy repo (read-only): no open/close animation; selection jumps or uses a tiny Style.duration move. Extend the VM scenario to capture screenshots of both layouts under two themes.

Visual quality is my check, not yours: say so, and list what to look at in the screenshots. Run `node --test`; after my push iterate CI to green and download the screenshots.

Update README.md (screenshots go in docs/images/ — copy the CI ones in this change only after I approve them), AGENTS.md. Flip TTO6 to ✅ in docs/PLAN.md in the same change, then show me the diff and a single block with BOTH the git commit ("tto-step-6: list and grid layouts, icons, highlights and theming") AND git push. Do not commit.
```

---

### TTO7 — Opt-in live window previews · Opus 5.5

**Verify:** VM job green: with previews on, the grid shows a thumbnail per window (screenshot artifact); with previews off (the default), no capture objects are created. Opening the switcher with previews on does not trigger Omarchy's remote-session probe (no `screencast` raw event, or the scenario proves the probe did not spawn). Closing the switcher releases every capture.
**Commit:** `tto-step-7: opt-in live window previews`

```text
Step TTO7: window thumbnails. Read AGENTS.md, docs/PLAN.md and docs/research/omarchy-plugin-api.md §5 — nothing in Omarchy captures individual windows yet, so this is a spike first.

1. Spike: Quickshell ScreencopyView with captureSource set to the HyprlandToplevel's wayland toplevel. Check in the VM: does a frame arrive, how long does the first frame take with 10 windows, does it emit a Hyprland `screencast` raw event (Omarchy's remote-session service reprobes — spawning a process — on every one: shell/plugins/services/remote-session/Service.qml:42-80 in the Omarchy repo, read-only), and does it work for windows on other workspaces and minimized ones. Record the answers in Implementation notes.
2. Implement behind a constant `previews = false` (TTO8 turns it into a setting): views exist only while the switcher is visible (inside a Loader active on opened && previews), one-shot capture rather than live unless the spike shows live is cheap, app icon as a badge on the thumbnail, graceful fallback to the icon card when a capture fails.
3. Scenario: previews on → screenshot; previews off → assert no ScreencopyView exists (log a count) ; probe check.

If screencopy of a toplevel is not possible on this Quickshell/Hyprland, STOP and report; do not substitute whole-screen grabs.

Run `node --test`; after my push iterate CI to green. Performance and visual quality on real hardware are my check.

Update README.md, AGENTS.md, Landmines. Flip TTO7 to ✅ in docs/PLAN.md in the same change, then show me the diff and a single block with BOTH the git commit ("tto-step-7: opt-in live window previews") AND git push. Do not commit.
```

---

### TTO8 — Settings · Sonnet 5.5

**Verify:** `node --test` passes (`lib/Settings.js`: defaults, validation, unknown keys ignored, bad values fall back to defaults — never crash). VM scenario: write settings through the IPC target, re-summon, layout changes; restart the shell, the setting persists in `~/.config/omarchy/shell.json`.
**Commit:** `tto-step-8: inline settings`

```text
Step TTO8: settings. Read AGENTS.md, docs/PLAN.md (Design Decisions: inline settings), docs/research/omarchy-plugin-api.md §1 (shell.updateEntryInline), and docs/research/port-spec.md §4 (the macOS config keys and which make sense on Linux).

Settings for 0.1.0 only: layout (list|grid), size (small|medium|large), showDelayMs, previews (bool), includeMinimized (bool), scope (all|workspace|monitor). lib/Settings.js validates leniently like the Swift Configuration (bad values → defaults, never throw). Read settings from the plugin's own entry at load and on change; write with shell.updateEntryInline(manifest.id, settings). Expose `settings` and `set <key> <value>` on the tapthetab IPC target. Document every key in README.md with an example of editing shell.json and of the IPC command.

Do not build a settings UI panel — a CLI/IPC surface is enough for 0.1.0 (a panel is in Later).

Run `node --test`; after my push iterate CI to green.

Update README.md, AGENTS.md. Flip TTO8 to ✅ in docs/PLAN.md in the same change, then show me the diff and a single block with BOTH the git commit ("tto-step-8: inline settings") AND git push. Do not commit.
```

---

### TTO9 — Release 0.1.0 · Sonnet 5.5

**Verify:** `node --test` and both CI jobs green on the release commit. `manifest.json` version 0.1.0 matches `CHANGELOG.md` and the tag. README has install, binding setup, undo, settings, privacy and a preview image. `docs/marketplace-submission.md` holds the exact text for the omacom/omarchy-plugin-marketplace issue form.
**Commit:** `tto-step-9: release 0.1.0`

```text
Step TTO9: release. Read AGENTS.md, docs/PLAN.md and docs/research/omarchy-plugin-api.md §8.

- README.md: final pass — what it is, a preview image from docs/images/, install (`omarchy plugin add https://github.com/memoliertorerr/tapthetab-omarchy.git --enable`), the bindings snippet and how to undo it, settings, privacy (no network, no telemetry), a link to the macOS app, MIT.
- CHANGELOG.md with 0.1.0; manifest.json version 0.1.0.
- docs/marketplace-submission.md: the fields the marketplace issue form asks for (repo link, category, tags, description), ready to paste. The submission is mine to make, and so is the GitHub release.
- Review the Deferred follow-ups list and tell me which ones should block the release.

Run `node --test`. Flip TTO9 to ✅ in docs/PLAN.md in the same change, then show me the diff and a single block with the git commit ("tto-step-9: release 0.1.0"), `git tag v0.1.0`, `git push` and `git push --tags`, plus the `gh release create v0.1.0` command for me to run. Do not commit.
```

---

## Deferred follow-ups (cross-step, live tracker)

> Aggregates flagged-but-not-fixed items that survive individual steps. Cross off (strike through) when genuinely handled; don't silently delete lines.

- **Settings key names** (surfaced by TTO3). `lib/Settings.js` uses a nested schema; TTO8's prompt specifies flat keys (`layout`, `size`, `showDelayMs`, `previews`, `includeMinimized`, `scope`), which are easier to edit by hand in `shell.json`. TTO8 reshapes Settings.js to the flat keys.
- **Unicode coverage** (surfaced by TTO3). Without `Intl`, the segmenter skips full Unicode grapheme rules (Indic conjuncts, Hangul jamo composition, every script's combining marks) and folding skips expansions like `ß` → `ss`. Revisit if users report missed matches; if QV4 turns out to have `Intl.Segmenter`, feature-detect and prefer it.
- **QV4 `Array.prototype.sort` stability** (surfaced by TTO3). Unknown; lib code keeps explicit tie-breaks so it doesn't matter.
- **Scenario filter in the workflow** (surfaced by TTO2). `ci/run-scenarios` honours `TTO_SCENARIOS`, but `vm.yml` has no `workflow_dispatch` input that passes it through.
- **SearchMemory isn't recorded on activation** (surfaced by TTO4). Session supports it; Switcher.qml doesn't record picks yet.
- **No `no_anim` around the minimized-window move** (surfaced by TTO4). The development-branch dock sets and unsets it; the unset needs a 0.4 s delay, i.e. a timer.
- *(Steps add to this list as they surface out-of-scope friction.)*

---

## Landmines

Populated from real friction, not speculation:

- **The research read Omarchy's development branch; users run stable.** The first VM run failed with `OverlayWindow is not a type`: `qs.Ui` `OverlayWindow` exists only on `quattro`. Also missing in stable 4.0.6: `qs.Ui` `FilterInput`, `qs.Commons` `ShellIpc`, `o.bind_hold`. Present in stable: Lua bindings with `release = true`, `PanelWindow` overlays, `BorderSurface`, `Border.surfaceSpec`, the `Style`/`Color` tokens used so far, `Util.editsFilter`. Ground Rule 8 now requires checking APIs against the release tag.
- **Alt release on a layer surface is unproven.** Nothing in Omarchy's shell handles `Keys.onReleased`; the research found no precedent. TTO5 spikes it with evidence and keeps the Hyprland release bind as the fallback.
- **`lastIpcObject.focusHistoryID` is stale** until `Hyprland.refreshToplevels()` runs; Omarchy's notifications service debounces and waits 250 ms after refreshing. Hence our own MRU from `activewindowv2` (Design Decisions).
- **Window capture can make Omarchy spawn processes.** Its remote-session service reprobes on every Hyprland `screencast` raw event. TTO7 checks this before shipping previews.
- **`omarchy plugin add` needs a git repo with a commit** (it runs `git clone`) and never runs install hooks — so bindings are a documented snippet, and CI installs from the checkout's `.git`.
- **Third-party ids may not start with `omarchy.`**, and the plugin folder may contain no symlinks (the validator rejects both).
- **The agent can't create public GitHub surfaces.** Its safety check blocked `gh repo create --public` in TTO0; the developer runs repo creation, releases and the marketplace submission.
- **No local Omarchy.** Development happens on an Apple Silicon Mac with no Quickshell or Hyprland; QML is first exercised in the CI VM. Expect a fix-commit round trip on QML-heavy steps. A local Omarchy VM needs about 40–50 GB free disk (the Mac had 13.5 GB free on 2026-10-30).
- **qmllint can't resolve `qs.*` with only `-I "$OMARCHY_PATH/shell"`.** Omarchy's qmldir files say `module qs.Commons` but live at `shell/Commons`, so qmllint looks for `<import path>/qs/Commons`. The scenario links `qs` to the shell directory in a scratch import root. Omarchy itself never runs qmllint, so there's nothing to copy.
- **`systemd-run` rewrites `${...}` in the command it starts.** Unless given `--expand-environment=no`, it substitutes `${VAR}` forms itself (unset → empty) before bash runs, while bare `$VAR` survives. The qmllint snippet's `${files[@]}` became empty and `(( ${#files[@]} == 0 ))` became a syntax error that `if` swallowed, so two runs "passed" lint without linting anything. `ci/lib.sh` now passes the flag; keep it.
- **Stable Omarchy's shell starts processes while idle** (battery every 30 s, keyboard layout, tailscale, dropbox, agents), so a no-spawn check against the session shell fails regardless of the plugin. `03-idle-no-spawn.sh` watches a plugin-only second shell instead. For TTO5: that second shell will also register any `GlobalShortcut` with appid `tapthetab`.
- **Exclusive-keyboard layers block window focus.** A focus dispatch sent while the overlay is mapped is ignored; send it again on the overlay's `closelayer`.
- **Raw-event addresses lack `0x`**; toplevel and `hyprctl` addresses carry it. `lib/Windows.js` normalises both.
- **Named workspaces have negative ids** (from -1337 down), like special ones; tell them apart by the `special` name prefix.
- **`Util.editsFilter` ignores Alt-modified keys.** Fine for typing; matters for TTO5, where Alt is held while typing.
- **A plain SSH login has no desktop environment.** `hyprctl`, `grim` and `omarchy-shell` need the session's environment; scenarios go through `in_session` (`systemd-run --user`).
- **A summon right after `omarchy plugin add --enable` can answer `unknown`** until the shell reloads `shell.json`. It queues nothing, so the scenario retries.
- **An overlay can be transparent for its first frames** (until the output's scale arrives); a screenshot taken the instant the layer maps can be empty, so scenarios wait a second first.
- **The CI image (Omarchy 4.0.6-1 on 2026-10-30) is not the `quattro` checkout the research read** (`4.0.0.alpha`). Line numbers in `docs/research/omarchy-plugin-api.md` may not match what the VM runs.
- **The CI image is Omarchy's moving stable release** from nightly.omarchy.org. A new Omarchy release can change shell APIs under us; the run summary prints the image's Omarchy version — check it first when a previously green scenario goes red.

---

## Later — designed, NOT built in 0.1.0

Everything below is intentionally out of scope. Recorded so the boundary is explicit and so nobody half-builds one of these while working through the steps.

| Item | Design | What it needs |
|---|---|---|
| **Same-app switcher** (Alt+`) | A second global shortcut `tapthetab:next-same-app`; Session filtered to the focused window's appId | A scope input in lib/Session.js; one more binding in the snippet |
| **Window actions** | Shift+letter actions from the Swift KeyRouter (close, minimize, fullscreen) mapped to Hyprland dispatchers | lib/Keys.js action inputs; optimistic list update |
| **Group by app, pinning, quick-select digits, peek** | Port ItemOrdering, QuickSelect and peek from TapTheTabCore | Each its own step; settings keys |
| **Arc-style gradient themes** | Port ColorMath/ColorTheme/GrainTexture from the Swift app as an alternative to Omarchy's theme colours | A rendering approach for grain in QML; keep Omarchy theme the default |
| **Settings panel** | An Omarchy `panel` kind or a menu entry editing the inline settings | A second entry point; UI |
| **Translations** | Strings through a small lookup table; Omarchy's i18n conventions | Omarchy's `docs/i18n.md` approach for plugins |
| **Other compositors / non-Omarchy Hyprland** | A standalone Quickshell config reusing lib/ | Replacing qs.Commons / qs.Ui dependencies |
| **Propose as Omarchy's default Alt+Tab** | Discussions > Suggestions in omacom/omarchy, once the plugin has users | Users, a stable release, and a track record of contributions |

**When Later work starts:** same-app switcher first (smallest, most asked-for on macOS), then window actions, then the settings panel.
