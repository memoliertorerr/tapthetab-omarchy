// lib/Windows.js: Hyprland toplevel snapshots → switcher items in MRU order,
// raw-event tracking, the one-time seed from focus history, and the focus
// dispatches.

const test = require("node:test")
const assert = require("node:assert/strict")
const { node, qml } = require("./helpers/qml-loader.js")

const Windows = node("Windows.js")
const Recency = node("Recency.js")

// A toplevel as Switcher.qml snapshots it. Quickshell's toplevel addresses and
// hyprctl's carry 0x; raw events do not.
function snapshot(address, title, extra = {}) {
  return { address: "0x" + address, appId: "tto.test", title, parented: false, workspace: { id: 1, name: "1" }, focusHistoryID: null, ...extra }
}

function titles(items) {
  return items.map((item) => item.title)
}

test("addresses normalise to lower-case hex without 0x, and anything else is no address", () => {
  const cases = [
    ["raw event form", "55ab01", "55ab01"],
    ["hyprctl form", "0x55ab01", "55ab01"],
    ["upper case", "0x55AB01", "55ab01"],
    ["surrounding space", " 0x55ab01 ", "55ab01"],
    ["empty", "", ""],
    ["null", null, ""],
    ["undefined", undefined, ""],
    ["bare 0x", "0x", ""],
    ["not hex", "0x55zz", ""],
    ["a selector, not an address", "address:0x55ab", ""],
    ["Lua injection", "55ab\" }) os.exit(", ""]
  ]
  for (const [name, input, expected] of cases) assert.equal(Windows.normalizeAddress(input), expected, name)
})

test("a raw event's address and the toplevel's address name the same window", () => {
  assert.equal(Windows.windowId("55ab01"), Windows.windowId("0x55AB01"))
  assert.equal(Windows.windowId("55ab01"), "window:55ab01")
  assert.equal(Windows.windowId(""), "")
})

test("windows without an app id or address, and child windows, are not listed", () => {
  const snapshots = [
    snapshot("a1", "listed"),
    snapshot("a2", "no app id", { appId: "" }),
    snapshot("a3", "dialog", { parented: true }),
    { ...snapshot("a4", "no address"), address: "" }
  ]
  assert.deepEqual(titles(Windows.items(snapshots, Recency.create())), ["listed"])
})

test("an item has the Session item shape", () => {
  const recency = Recency.create()
  Recency.touch(recency, "window:a1")
  const [item] = Windows.items([snapshot("A1", "Inbox", { pid: 42, monitor: "Virtual-1", workspace: { id: 3, name: "3" } })], recency, { activeWorkspaceId: 3 })
  assert.deepEqual(item, {
    id: "window:a1",
    address: "a1",
    pid: 42,
    title: "Inbox",
    appName: "tto.test",
    appId: "tto.test",
    workspace: "3",
    workspaceId: 3,
    monitor: "Virtual-1",
    minimized: false,
    focusStamp: 1,
    onActiveWorkspace: true
  })
})

test("app names come from reverse-DNS app ids, or an explicit name", () => {
  const cases = [
    ["reverse DNS", { appId: "org.gnome.Nautilus" }, "Nautilus"],
    ["plain", { appId: "foot" }, "foot"],
    ["two parts stay whole", { appId: "tto.test" }, "tto.test"],
    ["trailing dot keeps the id", { appId: "org.example." }, "org.example."],
    ["explicit name wins", { appId: "org.gnome.Nautilus", appName: "Files" }, "Files"]
  ]
  for (const [name, extra, expected] of cases) {
    assert.equal(Windows.items([snapshot("a1", "t", extra)], Recency.create())[0].appName, expected, name)
  }
})

test("windows on special workspaces are minimized; others are not", () => {
  const cases = [
    ["regular", { id: 2, name: "2" }, false],
    ["minimized", { id: -98, name: "special:minimized" }, true],
    ["scratchpad", { id: -99, name: "special:scratchpad" }, true],
    ["plain special", { id: -97, name: "special" }, true],
    ["negative id only", { id: -5, name: "" }, true],
    ["named like special but not", { id: 4, name: "specialist" }, false],
    ["ordinary named workspace", { id: -1337, name: "work" }, false],
    ["special with no name", { id: -98, name: "" }, true],
    ["unknown", null, false]
  ]
  for (const [name, workspace, minimized] of cases) {
    assert.equal(Windows.items([snapshot("a1", "t", { workspace })], Recency.create())[0].minimized, minimized, name)
  }
})

test("onActiveWorkspace is set only when the active workspace is known", () => {
  const snapshots = [snapshot("a1", "here", { workspace: { id: 2, name: "2" } }), snapshot("a2", "there", { workspace: { id: 5, name: "5" } })]
  const known = Windows.items(snapshots, Recency.create(), { activeWorkspaceId: 2 })
  assert.deepEqual(known.map((item) => item.onActiveWorkspace), [true, false])
  const unknown = Windows.items(snapshots, Recency.create())
  assert.deepEqual(unknown.map((item) => "onActiveWorkspace" in item), [false, false])
})

test("focus events order the list most recent first, whatever form the address takes", () => {
  const recency = Recency.create()
  const snapshots = [snapshot("a1", "tto-a"), snapshot("b2", "tto-b"), snapshot("c3", "tto-c")]
  // Each window is focused as it opens; Hyprland's raw events drop the 0x.
  for (const address of ["a1", "B2", "0xc3"]) assert.equal(Windows.trackEvent(recency, "activewindowv2", address), true)
  assert.deepEqual(titles(Windows.items(snapshots, recency)), ["tto-c", "tto-b", "tto-a"])
  Windows.trackEvent(recency, "activewindowv2", "a1")
  assert.deepEqual(titles(Windows.items(snapshots, recency)), ["tto-a", "tto-c", "tto-b"])
})

test("focus moving to a layer or nowhere leaves the order alone", () => {
  const recency = Recency.create()
  Windows.trackEvent(recency, "activewindowv2", "a1")
  for (const data of ["", ",", null, undefined]) assert.equal(Windows.trackEvent(recency, "activewindowv2", data), false, String(data))
  assert.equal(Recency.trackedCount(recency), 1)
})

test("a closed window is forgotten, and a window opened since is listed after the focused ones", () => {
  const recency = Recency.create()
  Windows.trackEvent(recency, "activewindowv2", "a1")
  Windows.trackEvent(recency, "activewindowv2", "b2")
  assert.equal(Windows.trackEvent(recency, "closewindow", "b2"), true)
  assert.equal(Recency.stamp(recency, "window:b2"), undefined)
  // d4 opened in the background between summons: never focused, so unstamped.
  const snapshots = [snapshot("d4", "new"), snapshot("a1", "tto-a")]
  assert.deepEqual(titles(Windows.items(snapshots, recency)), ["tto-a", "new"])
})

test("events that carry more than an address are not focus or close", () => {
  const recency = Recency.create()
  assert.equal(Windows.trackEvent(recency, "openwindow", "a1,1,tto.test,tto-a, with a comma"), false)
  assert.equal(Windows.trackEvent(recency, "movewindowv2", "a1,2,2"), false)
  assert.equal(Windows.trackEvent(recency, "workspacev2", "2,2"), false)
  assert.equal(Recency.trackedCount(recency), 0)
})

test("opening, closing, moving and renaming windows changes the list; focus does not", () => {
  for (const name of ["openwindow", "closewindow", "movewindowv2", "windowtitlev2"]) assert.equal(Windows.changesList(name), true, name)
  for (const name of ["activewindowv2", "closelayer"]) assert.equal(Windows.changesList(name), false, name)
})

test("forgetMissing drops stamps of windows no snapshot lists", () => {
  const recency = Recency.create()
  for (const address of ["a1", "b2", "c3"]) Windows.trackEvent(recency, "activewindowv2", address)
  Windows.forgetMissing(recency, [snapshot("a1", "tto-a"), snapshot("c3", "tto-c")])
  assert.equal(Recency.trackedCount(recency), 2)
  assert.equal(Recency.stamp(recency, "window:b2"), undefined)
})

test("the seed orders windows by focus history, after the ones focused since load", () => {
  const recency = Recency.create()
  // b2 was focused after the plugin loaded; the others only have history.
  Windows.trackEvent(recency, "activewindowv2", "b2")
  const snapshots = [
    snapshot("a1", "two back", { focusHistoryID: 2 }),
    snapshot("b2", "focused since", { focusHistoryID: 3 }),
    snapshot("c3", "one back", { focusHistoryID: 1 }),
    snapshot("d4", "no history", { focusHistoryID: null }),
    snapshot("e5", "current at load", { focusHistoryID: 0 })
  ]
  assert.equal(Windows.seed(recency, snapshots), true)
  assert.deepEqual(titles(Windows.items(snapshots, recency)), ["focused since", "current at load", "one back", "two back", "no history"])
  // Focus after the seed still wins.
  Windows.trackEvent(recency, "activewindowv2", "a1")
  assert.equal(Windows.items(snapshots, recency)[0].title, "two back")
})

test("without any focus history the seed changes nothing and says so", () => {
  const recency = Recency.create()
  Windows.trackEvent(recency, "activewindowv2", "a1")
  const before = JSON.stringify(recency)
  assert.equal(Windows.seed(recency, [snapshot("a1", "t"), snapshot("b2", "u", { focusHistoryID: -1 })]), false)
  assert.equal(JSON.stringify(recency), before)
})

test("focus steps focus and raise the window, in stable Omarchy's dispatch syntax", () => {
  assert.deepEqual(Windows.focusSteps({ address: "55ab01", minimized: false }, { id: 1, name: "1" }), [
    "hl.dsp.focus({ window = \"address:0x55ab01\" })",
    "hl.dsp.window.alter_zorder({ window = \"address:0x55ab01\", mode = \"top\" })"
  ])
})

test("a minimized window first moves to the active workspace", () => {
  assert.deepEqual(Windows.focusSteps({ address: "0x55AB01", minimized: true }, { id: 3, name: "3" }), [
    "hl.dsp.window.move({ window = \"address:0x55ab01\", workspace = \"3\" })",
    "hl.dsp.focus({ window = \"address:0x55ab01\" })",
    "hl.dsp.window.alter_zorder({ window = \"address:0x55ab01\", mode = \"top\" })"
  ])
})

test("a minimized window moves to an active named workspace by name", () => {
  const steps = Windows.focusSteps({ address: "55ab01", minimized: true }, { id: -1337, name: "work" })
  assert.equal(steps[0], "hl.dsp.window.move({ window = \"address:0x55ab01\", workspace = \"name:work\" })")
})

test("a minimized window is not moved to a special, unknown or oddly named workspace, only focused", () => {
  const workspaces = [{ id: -98, name: "special:minimized" }, { id: 0, name: "" }, { id: 2.5, name: "" }, { id: -1338, name: "a\"b" }, { id: -1339, name: "x\ny" }, null, undefined]
  for (const workspace of workspaces) {
    const steps = Windows.focusSteps({ address: "55ab01", minimized: true }, workspace)
    assert.equal(steps.length, 2, JSON.stringify(workspace))
    assert.match(steps[0], /^hl\.dsp\.focus/)
  }
})

test("no valid address, no dispatch", () => {
  for (const item of [{ address: "" }, { address: "x\"y" }, {}, null]) assert.deepEqual(Windows.focusSteps(item, { id: 1, name: "1" }), [])
})

test("the QML path reaches Recency through its .import alias", () => {
  const inQml = qml("Windows.js")
  const recency = inQml.Recency.create()
  inQml.trackEvent(recency, "activewindowv2", "a1")
  inQml.trackEvent(recency, "activewindowv2", "b2")
  const items = inQml.items([snapshot("a1", "tto-a"), snapshot("b2", "tto-b")], recency, { activeWorkspaceId: 1 })
  assert.deepEqual(JSON.parse(JSON.stringify(items.map((item) => item.title))), ["tto-b", "tto-a"])
  assert.equal(inQml.seed(recency, [snapshot("a1", "tto-a", { focusHistoryID: 0 })]), true)
})
