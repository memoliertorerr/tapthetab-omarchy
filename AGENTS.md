# TapTheTab for Omarchy

A third-party plugin for the Omarchy desktop (Quickshell/QML on Hyprland): a keyboard-first, search-first window switcher. Hold Alt, tap Tab, see every window most recent first, type to filter, release to switch. It is the Linux sibling of the macOS app TapTheTab (`../tapthetab`, Swift), which is the behavioural reference; no code is shared.

The build is driven by [`docs/PLAN.md`](docs/PLAN.md): read its Progress Tracker to know where things stand, and follow the step prompt for the step you're doing.

## Non-negotiable rules

- **Never run `git commit` or `git push`.** Hand the developer one block with both and stop.
- **No polling, no idle processes.** React to Hyprland raw events and Quickshell signals. No `Timer` that starts a `Process`. Timers run only while the switcher is open.
- **Never edit the user's config automatically.** Keybindings are a snippet the user pastes in.
- **No network access, no telemetry.**
- **Plugin id `memoliertorerr.tapthetab`, global shortcut appid and IPC target `tapthetab`.** Never change them.
- **Never modify `../tapthetab` or the Omarchy source checkout** (`/Users/memoli/Downloads/omarchy-quattro`). Both are read-only references.
- **Say what you could not verify.** This Mac has no Quickshell or Hyprland; QML runs only in the CI VM and on the developer's Omarchy machine. Visuals and feel are the developer's check.

## File structure

```
manifest.json            Omarchy plugin manifest
Switcher.qml             overlay entry point: wiring and visuals only
lib/Graphemes.js         grapheme clusters, folding, letter/number classes (stand-ins for Swift Character and String.folding)
lib/Fuzzy.js             fuzzy scores and highlight indices (FuzzyMatcher)
lib/Recency.js           focus stamps and MRU order (RecencyTracker)
lib/Filter.js            stable filtering and scopes (ItemFilter)
lib/Session.js           the switcher state machine: handle(state, input) → { state, effect } (SwitcherSession)
lib/Keys.js              key event → session input (KeyRouter)
lib/SearchMemory.js      bounded in-memory pick history (SearchMemory)
lib/Settings.js          lenient settings decode and validation (Configuration)
tests/*.test.js          node:test unit tests
tests/helpers/qml-loader.js  loads lib/ modules in Node, either as CommonJS or the way QML does (aliases from .import)
ci/vm-boot               boots Omarchy's VM image (adapted from Omarchy's test/ci-vm)
ci/lib.sh                host-side helpers for scenarios (ssh, in_session, wait_layer, screenshot, open_window, qmp_key)
ci/run-scenarios         boots once, runs ci/scenarios/*.sh in order, collects logs
ci/scenarios/            end-to-end scenarios, NN-name.sh
extras/bindings.lua      snippet users paste into ~/.config/hypr/bindings.lua (arrives in TTO5)
docs/PLAN.md             build plan and progress tracker
docs/research/           research the plan is built on
```

Update this section whenever a step adds or moves files.

## Conventions

- **Pure logic in `lib/*.js`**, written for Quickshell's QML engine as Omarchy's shell JS is: first line `.pragma library`, then `.import "Other.js" as Other` lines, then `var Other = typeof require === "function" ? require("./Other.js") : Other`-style aliases, ES5 only (`var`, `function`; no classes, arrows, `let`/`const`, template literals, spread, destructuring), no semicolons, no `Intl`, no regex `u` flag or `\p{}`, ending with `if (typeof module !== "undefined") module.exports = {...}`. `tests/engine-compat.test.js` enforces this. QML holds wiring and visuals only.
- **Text handling** covers what window titles need (accents, combining marks, emoji ZWJ sequences, flags, skin tones, fullwidth forms, stroked letters), not every Unicode rule; see the header of `lib/Graphemes.js` for what it leaves out.
- **Tests:** `node --test` (Node 24, no dependencies), files `tests/<module>.test.js`, table-driven with named cases. Load lib modules through `tests/helpers/qml-loader.js`: `node(name)` for the CommonJS path, `qml(name, prelude)` to evaluate a module the way QML does. Each module with `.import` lines keeps at least one test through `qml()`. Tests earn their place by catching a real regression; don't test that a string you just added is present.
- **Omarchy shell rules:** entry point is an `Item` with `open(payloadJson)`, `close()` and `opened`; `import qs.Commons as Commons` for colours (`Commons.Color.menu.*`) and fonts (`Style.font.menuFamily`); `qs.Ui` `OverlayWindow` for the surface. No open/close animation. Every duration through `Style.duration(ms)` with `Style.easeOut`, nothing over 300 ms. Details and line references: [`docs/research/omarchy-plugin-api.md`](docs/research/omarchy-plugin-api.md).
- **Focus windows in-process** with `Hyprland.dispatch(...)`, not a `hyprctl` process.
- **Shell scripts:** `#!/bin/bash`, `set -euo pipefail`, two-space indent, `[[ ]]` for strings and files, `(( ))` for numbers — the same style as Omarchy.
- **Markdown:** full lines, no hard wrapping.
- **Commits:** one step per commit, `tto-step-N: <message>`; follow-up fixes inside a step use the same prefix.

## Verify

- Locally: `node --test`.
- On GitHub after a push: the `ci` workflow (unit tests) and the `vm` workflow. Read results with `gh run list`, `gh run view --log-failed` and `gh run download`.

### How the VM job and scenarios work

The `vm` workflow boots Omarchy's stable VM image under KVM, runs `ci/run-scenarios`, and uploads `out/` (scenario logs, `summary.md`, `screenshots/`, `qmllint.txt`, plus `shell.log`, `journal.log` and `hyprland.txt` on failure). `ci/vm-boot` boots once and copies the checkout with `.git` to `~/src/tapthetab-omarchy`; scenarios install the plugin from it with `omarchy plugin add`, so only committed content is tested. Scenarios are host-side bash files `ci/scenarios/NN-name.sh` that source `ci/lib.sh` and run in order against the same VM, so a later scenario starts with the plugin already installed. Anything that talks to Hyprland or the shell goes through `in_session` (a `systemd-run --user` unit with the session's environment), never plain `ssh_vm`. Real keys go through `qmp_key` / `qmp_tap` with QEMU qcodes (`alt`, `tab`, `shift`, `esc`). `ci/run-scenarios` runs only the scenarios matching `TTO_SCENARIOS` (a glob, e.g. `01-*`) when it is set; the workflow does not expose it as an input yet.
