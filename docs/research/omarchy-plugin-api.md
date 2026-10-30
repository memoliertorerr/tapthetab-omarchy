# Omarchy plugin API research

Research snapshot taken 2026-10-30 against the Omarchy source on branch `quattro`. Paths and line numbers are in the Omarchy repo, not this one; re-check them before relying on them, since Omarchy moves fast.

> **Correction (2026-10-31):** `quattro` is Omarchy's development branch. Users and the CI VM run the stable release (4.0.6), which lacks several things described below: `qs.Ui` `OverlayWindow` and `FilterInput`, `qs.Commons` `ShellIpc`, and `o.bind_hold`. Use a plain `PanelWindow` (as stable's emoji picker does), Quickshell's `IpcHandler`, and `o.bind(..., { release = true })`. Check any API at the release tag before using it (PLAN Ground Rule 8).

**Bottom line:** no hard blocker. A third-party plugin is unsandboxed QML inside `omarchy-shell`. It can import `qs.Commons`, `qs.Ui`, `Quickshell.Hyprland`, `Quickshell.Wayland` and `Quickshell.Io`, create its own `PanelWindow` with `WlrKeyboardFocus.Exclusive`, run processes, and register its own IPC targets and Hyprland global shortcuts. The one real unknown: whether Qt delivers a key **release** for Alt when the overlay took keyboard focus while Alt was already held. There is a fallback (a Hyprland release bind on the Alt keysym, see §3).

## 1. Plugin contract

### Manifest

- Docs: `docs/omarchy-shell.md:12-56`, `manual/32-shell-plugins.md:75-96`.
- Shell validator: `shell/services/PluginRegistry.qml:43-90`. `schemaVersion === 1`; required `id`, `name`, `version`, `kinds`, `entryPoints`; id without `/` or `..`; non-empty `kinds`; `entryPoints` an object with relative paths and no `..`.
- Third-party ids starting with `omarchy.` are rejected (`PluginRegistry.qml:658-668`).
- CLI validator: `bin/omarchy-plugin-validate`. Id regex `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Each kind needs its entry key (`overlay` → `entryPoints.overlay`, `service` → `entryPoints.service`, …). Entry files must exist. No symlinks anywhere in the folder (`.git` excepted).
- Kinds: `bar-widget`, `bar`, `panel`, `overlay`, `menu`, `service`.
- Optional: `keepLoaded: true` keeps the instance mounted between summons (needed so our shortcuts and IPC exist before the first summon). `author`, `description`, `license` accepted. `omarchy.capabilities` is first-party only. Never set `omarchy.clonedFrom`.
- There is no permissions field for third-party plugins.

### Loading

- Discovery: `~/.config/omarchy/plugins/*/manifest.json`, hot-reloaded via inotify (`PluginRegistry.qml:726-784`).
- Enabled when the id is in `shell.json` `plugins[]` (or a bar layout / `bar.id`).
- One async `Loader` per enabled overlay/panel/menu plugin (`shell.qml:1364-1432`). `shell.summon` calls `item.open(payloadJson)`; `hide` calls `item.close()`; toggle state reads `item.opened`.
- Third-party service objects are created with a null parent (`shell.qml:953`).

### What the plugin receives

Each injected only if the entry item declares the property (`shell.qml:1405-1416`):

- `omarchyPath` (string).
- `manifest`: public copy; `__sourceDir` kept, so the plugin can find its bundled files.
- `shell`: `PluginShellApi` facade. `summon`/`hide`/`toggle`/`isPluginOpen` limited to its own id; `updateEntryInline(ownId, settings)` persists its own settings into its `plugins[]` entry; `serviceFor(ownId)`; `bar` scalar state; `barConfig`, `idleConfig` snapshots.
- `pluginRegistry`: read-only view of itself. `barWidgetRegistry`: snapshot. `service`: its own service instance.

### Capabilities

- Theme: `import qs.Commons as Commons`, then `Commons.Color.menu.{background,text,border,scrim,selectedBackground,selectedText,selectedBorder}` (`shell/Commons/Color.qml:100-108`); fonts `Style.font.menuFamily`, `Style.font.family`, `Style.font.<scale>`; `Style.spacing.*`, `Style.cornerRadius`, `Style.duration()`, `Style.easeOut`; borders via `BorderSurface` (`docs/theming.md:318-345`).
- Processes: `Quickshell.Io` `Process`, `Quickshell.execDetached`, `Util.execDetached` / `Util.shellQuote`.
- `Quickshell.Hyprland` / `Quickshell.Wayland`: plain imports, not gated.
- Surfaces: the host mounts only an `Item`; overlays create their own window, usually via `qs.Ui` `OverlayWindow` (`shell/Ui/OverlayWindow.qml:10-102`). Example: `Emojis.qml:161-164`.
- Exclusive keyboard: `OverlayWindow` defaults to `WlrKeyboardFocus.Exclusive` on `WlrLayer.Overlay`. Keys already work while the surface is at opacity 0 (`OverlayWindow.qml:83-89`), which suits the quick-tap trick. Focus pattern: `keyCatcher.forceActiveFocus()` in `open()` with `Keys.priority: Keys.BeforeItem` (`Emojis.qml:46-53, 187-226`).

## 2. Summoning

- `bin/omarchy-shell <target> <method> [args]`: fast socket via socat (~5 ms), falls back to `qs ipc call`.
- Generic host verbs on target `shell`: `summon <id> <json>`, `hide <id>`, `toggle <id> <json>`, `call <id> <method> <arg>` (any public function on a loaded item).
- Own IPC target: `ShellIpc { target: "tapthetab"; function next(): string {…} }` from `qs.Commons` (fast socket), or a plain `IpcHandler`.
- Global shortcuts without spawning a process: first-party ones come from the package file `default/omarchy/shortcuts`, which third-party plugins can't extend. Workaround: declare our own `GlobalShortcut { appid: "tapthetab"; name: "next" }` (Quickshell.Hyprland) inside the `keepLoaded` plugin; the user binds `hl.dsp.global("tapthetab:next")`.

## 3. Keybindings and key release

- Lua helper `default/hypr/helpers.lua`: `o.bind(keys, description, dispatcher, options)`; `o.rebind` = `hl.unbind` + `o.bind`; option keys include `release` (= Hyprland `bindr`), `transparent`, `ignore_mods`, `non_consuming`, `repeating`, `locked`.
- `o.bind_hold(keys, pressDesc, press, releaseDesc, release, options)` pairs press and release.
- Modifier-only release precedent (`default/hypr/bindings/dictation.lua:12-14`): `o.bind_hold("ALT + Alt_R", …, { ignore_mods = true })` — match the keysym independently of the modifier mask.
- User overrides go in `~/.config/hypr/bindings.lua` (loaded after the defaults, `config/hypr/hyprland.lua:17-24`).
- Default ALT+TAB is four binds on two chords (`default/hypr/bindings/tiling.lua:55-58`): `cycle_next` and `bring_to_top` on `ALT + TAB` and `ALT + SHIFT + TAB`.

Candidate user snippet (verify `hl.unbind` removes both binds on a chord):

```lua
hl.unbind("ALT + TAB")
hl.unbind("ALT + SHIFT + TAB")
o.bind("ALT + TAB", "TapTheTab next", hl.dsp.global("tapthetab:next"))
o.bind("ALT + SHIFT + TAB", "TapTheTab previous", hl.dsp.global("tapthetab:prev"))
o.bind("ALT + Alt_L", "TapTheTab commit", hl.dsp.global("tapthetab:commit"),
       { release = true, transparent = true, ignore_mods = true, non_consuming = true })
```

`omarchy plugin add` runs no install hooks, so users paste this themselves (README).

**Key release inside QML is unverified (main risk).** Nothing in `shell/` uses `Keys.onReleased`. Spike: in an Exclusive `OverlayWindow`, handle `Keys.onReleased` (`event.key === Qt.Key_Alt` or Alt gone from `event.modifiers`). Fallback: the Hyprland release bind above. Make `commit` idempotent so both paths can coexist. Quick tap: if commit arrives before a reveal timer fires, focus the previous MRU window without ever showing the UI.

## 4. Window data and focus

- Dock (`shell/plugins/dock/Dock.qml:55-79`): `Hyprland.toplevels.values`, each `.wayland` is a `Toplevel` (`appId`, `title`, `activated`, `activate()`, `close()`); skip entries without `appId` or with a `parent`. Icons via `DesktopEntries.heuristicLookup(appId)` + `Quickshell.iconPath(icon, true)`.
- Focusing: `Dock.qml:186-214` (`bringForward`) moves minimized windows to the active workspace, then `hl.dsp.focus({ window = "address:…" })` + `hl.dsp.window.alter_zorder({ mode = "top", … })`.
- In-process dispatch, no process: `Hyprland.dispatch('hl.dsp.focus({window = hl.get_window("address:' + addr + '")})')` (`shell/plugins/notifications/Service.qml:1060`). Prefer this.
- MRU: `HyprlandToplevel.lastIpcObject.focusHistoryID` (0 = current, 1 = previous), but `lastIpcObject` is stale until `Hyprland.refreshToplevels()`. Recommendation: keep our own MRU list from `Hyprland.onRawEvent` `activewindowv2` events, seeded once from `focusHistoryID`. React to `openwindow`/`closewindow` too. No timers.

## 5. Thumbnails

- No `ScreencopyView` or per-window capture exists anywhere in `shell/`; we'd be first. Starting point: Quickshell `ScreencopyView { captureSource: toplevel.wayland }`.
- Risk: the remote-session service reprobes (spawning `bash probe.sh`) on every Hyprland `screencast` raw event (`plugins/services/remote-session/Service.qml:42-80`). Check whether toplevel screencopy emits `screencast`; capture only while open, avoid `live`.

## 6. Testing

- Pure JS logic in `.js` files with a `module.exports` guard, unit-tested with node (`docs/testing.md:117-143`).
- `test/shell.d/base-test.sh`: `require_quickshell`, `run_qml_fixture`, `setup_scratch_shell`, `scratch_ipc`, `wait_scratch_layer <namespace> mapped|absent` (polls `hyprctl -j layers`).
- `shell-idle-spawn-test.sh` fails a shell that spawns any process in 30 idle seconds.
- Third-party precedent: `test/shell.d/runtime-smoke-test.sh` writes plugins into the scratch `~/.config/omarchy/plugins/<id>`, enables with `setPluginEnabled <id> true`, summons via IPC.
- `omarchy plugin add` accepts a local git repo path or `file://` URL (it runs `git clone`, so the source needs a commit). Non-interactive: `omarchy plugin add <path> --yes --enable`. Or copy the folder in, then `omarchy-shell shell rescanPlugins` and `omarchy plugin enable <id>`.
- Omarchy's own CI (`.github/workflows/test.yml`, `test/ci-vm`) boots the stable Omarchy VM image under KVM on `ubuntu-26.04` runners inside an Arch container, SSHes in, waits for the Hyprland session, and runs tests in the logged-in desktop. We reuse that pattern.

## 7. Rules for an overlay plugin

- Entry points are `Item`s. Overlays expose `open(payloadJson)`, `close()`, `opened`. Dismiss with `shell.hide(manifest.id)`.
- No polling: react to Hyprland raw events; never a Timer that starts a Process.
- Motion (`agents/skills/motion.md`): pickers summoned by a keystroke many times a day do not animate open/close. Selection moves jump or stay tiny. Every duration goes through `Style.duration(ms)`; `Style.easeOut`; nothing over 300 ms; loops gated on `!Style.reduceMotion`.
- Reusable `qs.Ui`: `OverlayWindow`, `BorderSurface`, `FilterInput`; `Util.editsFilter` / `Util.editedFilter` for type-to-filter.
- Lint: `qmllint -I "$OMARCHY_PATH/shell"`. Logs: `qs log -p "$OMARCHY_PATH/shell" --tail 100`.

## 8. Publishing

- Public GitHub repo, `manifest.json` at root, README, license, optional preview image; run `omarchy plugin validate`.
- Listing requires `schemaVersion`, `id`, `name`, `version`, `author`, `description`, `kinds`, `entryPoints`.
- Submit via the issue form in `omacom/omarchy-plugin-marketplace`; automated validation, then maintainer approval.
- Use a permanent namespaced id before publishing.
- The catalog listed 0 community plugins at research time — no existing Alt-Tab plugin.
