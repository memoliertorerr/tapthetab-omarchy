// lib/Filter.js against port-spec.md section 5 (ItemFilterTests.swift), with
// workspaces and monitors in place of Spaces and displays.

const test = require("node:test")
const assert = require("node:assert/strict")
const { node } = require("./helpers/qml-loader.js")

const Filter = node("Filter.js")

// A window whose pid is its number, and a windowless app entry likewise.
function win(n, extra = {}) {
  return { id: "window:" + n, pid: n, appName: "App", ...extra }
}

function app(n, extra = {}) {
  return { ...win(n, extra), id: "app:" + n }
}

function applied(items, options = {}, scope = "allWindows", context = {}) {
  return Filter.apply(items, options, scope, context).map((item) => item.id)
}

function windowIds(numbers) {
  return numbers.map((n) => "window:" + n)
}

test("by default everything but windowless apps is listed, in the given order", () => {
  const items = [win(1), win(2, { minimized: true }), win(3, { hidden: true }), win(4, { onActiveWorkspace: false }), app(5)]
  assert.deepEqual(applied(items), windowIds([1, 2, 3, 4]))
  assert.deepEqual(applied([win(9), win(3), win(7), win(1)]), windowIds([9, 3, 7, 1]))
  assert.deepEqual(applied([], {}, "apps"), [])
})

test("showMinimized, showHiddenApps and showWindowlessApps switch their items", () => {
  const items = [win(1), win(2, { minimized: true }), win(3, { hidden: true }), win(4, { onActiveWorkspace: false }), app(5)]
  assert.deepEqual(applied(items, { showMinimized: false }), ["window:1", "window:3", "window:4"])
  assert.deepEqual(applied(items, { showHiddenApps: false, showWindowlessApps: true }), ["window:1", "window:2", "window:4", "app:5"])
})

test("currentWorkspaceOnly drops off-workspace windows but not minimized, hidden or windowless ones", () => {
  const items = [
    win(1, { minimized: true, onActiveWorkspace: false }),
    win(2, { hidden: true, onActiveWorkspace: false }),
    win(3, { onActiveWorkspace: false }),
    app(4, { onActiveWorkspace: false }),
    win(5, { fullscreen: true, onActiveWorkspace: false })
  ]
  assert.deepEqual(applied(items, { currentWorkspaceOnly: true, showWindowlessApps: true }), ["window:1", "window:2", "app:4"])
})

test("currentMonitorOnly drops a mismatch only when both monitors are known", () => {
  const items = [win(1, { monitor: 1 }), win(2, { monitor: 2 }), win(3)]
  assert.deepEqual(applied(items, { currentMonitorOnly: true }, "allWindows", { activeMonitor: 1 }), ["window:1", "window:3"])
  assert.deepEqual(applied(items, { currentMonitorOnly: true }), ["window:1", "window:2", "window:3"])
})

test("excluded app ids match case-insensitively, and an item without an app id never matches", () => {
  const items = [win(1, { appId: "COM.APP" }), win(2), app(3, { appId: "com.app" })]
  assert.deepEqual(applied(items, { excludedAppIds: ["com.app"], showWindowlessApps: true }), ["window:2"])
  assert.deepEqual(applied([win(2)], { excludedAppIds: ["", "undefined", "null"] }), ["window:2"])
})

test("the switcher's own process is never listed", () => {
  const items = [win(1, { pid: 10 }), win(2, { pid: 99 }), app(99)]
  assert.deepEqual(applied(items, { showWindowlessApps: true }, "allWindows", { ownPID: 99 }), ["window:1"])
})

test("activeApp keeps the active app's real windows", () => {
  const items = [win(1, { pid: 1 }), win(2, { pid: 2 }), win(3, { pid: 1 }), app(1)]
  assert.deepEqual(applied(items, { showWindowlessApps: true }, "activeApp", { activePID: 1 }), ["window:1", "window:3"])
  assert.deepEqual(applied([win(1, { minimized: true }), win(2, { pid: 1 })], { showMinimized: false }, "activeApp", { activePID: 1 }), ["window:2"])
})

test("activeApp falls back to the app's windowless entry when no window survives", () => {
  const items = [win(1, { pid: 1, minimized: true }), app(1)]
  assert.deepEqual(applied(items, { showMinimized: false }, "activeApp", { activePID: 1 }), ["app:1"])
})

test("the activeApp fallback never synthesizes an entry or bypasses another rule", () => {
  assert.deepEqual(applied([win(2), app(3)], {}, "activeApp", { activePID: 1 }), [])
  const hiddenExcludedApp = app(1, { appId: "x", hidden: true })
  const vetoes = [
    [{ excludedAppIds: ["x"] }, { activePID: 1 }],
    [{}, { activePID: 1, ownPID: 1 }],
    [{ showHiddenApps: false }, { activePID: 1 }]
  ]
  for (const [options, context] of vetoes) {
    assert.deepEqual(applied([hiddenExcludedApp], options, "activeApp", context), [], JSON.stringify([options, context]))
  }
})

test("activeApp with an unknown active pid leaves the filtered list unchanged", () => {
  assert.deepEqual(applied([win(1), win(2)], {}, "activeApp"), ["window:1", "window:2"])
})

test("apps keeps the first surviving item of each pid, after filtering", () => {
  const items = [win(1), win(2), win(3, { pid: 1 }), app(3), win(4, { pid: 2 })]
  assert.deepEqual(applied(items, { showWindowlessApps: true }, "apps"), ["window:1", "window:2", "app:3"])
  assert.deepEqual(applied([win(1, { minimized: true }), win(2, { pid: 1 })], { showMinimized: false }, "apps"), ["window:2"])
})

test("isWindowless depends on the id, not the title", () => {
  assert.equal(Filter.isWindowless({ id: "app:7", title: "Real title" }), true)
  assert.equal(Filter.isWindowless({ id: "window:7", title: "" }), false)
})
