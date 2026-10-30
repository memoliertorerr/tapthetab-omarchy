// lib/Session.js against port-spec.md sections 3 and 5 (SwitcherSessionTests.swift).

const test = require("node:test")
const assert = require("node:assert/strict")
const { node, qml } = require("./helpers/qml-loader.js")

const Session = node("Session.js")
const Memory = node("SearchMemory.js")

function item(n, appName = "App", title = "", extra = {}) {
  return { id: "window:" + n, pid: n, appName, title, ...extra }
}

const items = [
  item(1, "Safari", "Apple"),
  item(2, "Terminal", "zsh"),
  item(3, "Mail", "Inbox"),
  item(4, "Notes", "Shopping list"),
  item(5, "Xcode", "TapTheTab")
]

function ids(state) {
  return state.visible.map((row) => row.item.id)
}

// Feeds inputs to a session one at a time. Every send also checks that handle
// left the state it was given untouched, then moves on to the new state.
function driver(initial) {
  let state = initial
  return {
    get state() {
      return state
    },
    send(input) {
      const before = structuredClone(state)
      const result = Session.handle(state, input)
      assert.deepEqual(state, before, "handle must not mutate its input state")
      state = result.state
      return result.effect
    },
    replace(newItems) {
      const before = structuredClone(state)
      const next = Session.replaceItems(state, newItems)
      assert.deepEqual(state, before, "replaceItems must not mutate its input state")
      state = next
    }
  }
}

function typed(session, text) {
  session.send({ type: "type", text })
}

// --- Opening -------------------------------------------------------------

test("a session opens on the second item, the first if single, none if empty", () => {
  const cases = [
    ["several items", items, {}, 1],
    ["reverse trigger", items, { reverse: true }, 4],
    ["not starting on previous", items, { startsOnPrevious: false }, 0],
    ["a single item", [items[0]], {}, 0],
    ["a single item, reversed", [items[0]], { reverse: true }, 0],
    ["no items", [], {}, null],
    ["no items, reversed", [], { reverse: true }, null]
  ]
  for (const [name, list, options, expected] of cases) {
    assert.equal(Session.create(list, options).selectedIndex, expected, name)
  }
})

test("a new session lists every item unmatched and is not searching", () => {
  const state = Session.create(items)
  assert.equal(Session.isSearching(state), false)
  assert.deepEqual(ids(state), items.map((i) => i.id))
  assert.ok(state.visible.every((row) => row.match === null))
  assert.equal(Session.create(items, { columns: 0 }).columns, 1)
})

// --- Navigation ----------------------------------------------------------

test("linear navigation selects and wraps, each change a refresh", () => {
  const session = driver(Session.create(items))
  const steps = [
    ["next", 2],
    ["last", 4],
    ["next", 0],
    ["previous", 4],
    ["first", 0],
    ["moveDown", 1],
    ["moveUp", 0],
    ["moveRight", 1],
    ["moveLeft", 0],
    [{ type: "select", index: 3 }, 3]
  ]
  for (const [input, expectedIndex] of steps) {
    assert.equal(session.send(input).type, "refresh", JSON.stringify(input))
    assert.equal(session.state.selectedIndex, expectedIndex, JSON.stringify(input))
  }
})

test("selecting the current, an out-of-range or a fractional index changes nothing", () => {
  const session = driver(Session.create(items))
  session.send({ type: "select", index: 3 })
  for (const index of [3, 99, -1, 0.5]) {
    assert.equal(session.send({ type: "select", index }).type, "none", String(index))
    assert.equal(session.state.selectedIndex, 3)
  }
})

test("without wrapping, the edges clamp and report nothing", () => {
  const session = driver(Session.create(items, { wrapsAround: false }))
  session.send("first")
  assert.equal(session.send("previous").type, "none")
  assert.equal(session.state.selectedIndex, 0)
  session.send("last")
  assert.equal(session.send("next").type, "none")
  assert.equal(session.state.selectedIndex, 4)
})

test("a single item has nowhere to go", () => {
  assert.equal(Session.handle(Session.create([items[0]]), "next").effect.type, "none")
})

const NAVIGATION_INPUTS = ["next", "previous", "moveUp", "moveDown", "moveLeft", "moveRight", "first", "last"]

test("navigation with no items does nothing", () => {
  const session = driver(Session.create([]))
  for (const input of NAVIGATION_INPUTS) assert.equal(session.send(input).type, "none", input)
})

test("navigation with no search results does nothing", () => {
  const session = driver(Session.create(items))
  typed(session, "qqqq")
  assert.equal(session.state.selectedIndex, null)
  for (const input of NAVIGATION_INPUTS) assert.equal(session.send(input).type, "none", input)
  assert.equal(session.state.selectedIndex, null)
})

// start, input and expected index after, for a grid of `columns` columns.
const GRID_CASES = [
  // [item count, columns, wraps, start index, input, expected index, effect]
  [9, 3, true, 1, "moveDown", 4, "refresh"],
  [9, 3, true, 7, "moveUp", 4, "refresh"],
  [9, 3, true, 8, "moveDown", 2, "refresh"],
  [9, 3, true, 0, "moveUp", 6, "refresh"],
  [7, 3, true, 2, "moveUp", 6, "refresh"],
  [7, 3, true, 5, "moveDown", 6, "refresh"],
  [7, 3, true, 4, "moveDown", 6, "refresh"],
  [8, 3, false, 5, "moveDown", 7, "refresh"],
  [8, 3, false, 7, "moveDown", 7, "none"],
  [8, 3, true, 3, "moveDown", 6, "refresh"],
  [8, 3, true, 4, "moveDown", 7, "refresh"],
  [7, 3, true, 6, "moveDown", 0, "refresh"],
  [8, 3, true, 7, "moveDown", 1, "refresh"],
  [7, 3, true, 6, "moveUp", 3, "refresh"],
  [3, 4, true, 2, "moveDown", 2, "none"],
  [9, 3, false, 1, "moveUp", 1, "none"]
]

test("grid up and down move a row, land on a partial last row's end, and wrap by column", () => {
  for (const [count, columns, wraps, start, input, expectedIndex, effect] of GRID_CASES) {
    const list = Array.from({ length: count }, (_, i) => item(i))
    const session = driver(Session.create(list, { columns, wrapsAround: wraps }))
    session.send({ type: "select", index: start })
    const label = `${count} items, ${columns} columns, wrap ${wraps}, ${input} from ${start}`
    assert.equal(session.send(input).type, effect, label)
    assert.equal(session.state.selectedIndex, expectedIndex, label)
  }
})

test("the column count can change after the session is created", () => {
  const state = Session.create(Array.from({ length: 8 }, (_, i) => item(i)))
  state.columns = 4
  assert.equal(Session.handle(state, "moveDown").state.selectedIndex, 5)
})

// --- Searching -----------------------------------------------------------

test("typing drops line breaks and tabs, and a leading blank is ignored", () => {
  const session = driver(Session.create(items))
  assert.equal(session.send({ type: "type", text: " \t\n" }).type, "none")
  assert.equal(session.send("deleteBackward").type, "none")
  session.send({ type: "type", text: "ma\til\n\r\n" })
  assert.equal(session.state.query, "mail")
  assert.equal(Session.selectedItem(session.state).id, "window:3")
})

test("whitespace inside a query is kept, and each token matches on its own", () => {
  const session = driver(Session.create(items))
  typed(session, "shop")
  typed(session, " ")
  typed(session, "li")
  assert.equal(session.state.query, "shop li")
  assert.equal(Session.selectedItem(session.state).id, "window:4")
})

test("deleting back to an empty query restores the original list and opening selection", () => {
  const session = driver(Session.create(items))
  typed(session, "xc")
  assert.deepEqual(ids(session.state), ["window:5"])
  session.send("deleteBackward")
  session.send("deleteBackward")
  assert.equal(session.state.query, "")
  assert.equal(session.state.selectedIndex, 1)
  assert.deepEqual(ids(session.state), items.map((i) => i.id))
})

test("deleting keeps the selected item selected while the query stays non-empty", () => {
  const titles = ["alpha", "alpine", "albatross"]
  const session = driver(Session.create(titles.map((title, i) => item(i + 1, "Ed", title))))
  typed(session, "al")
  typed(session, "b")
  session.send("deleteBackward")
  assert.equal(session.state.query, "al")
  assert.equal(session.state.selectedIndex, 2)
})

test("deleting removes one whole grapheme", () => {
  const session = driver(Session.create(items))
  typed(session, "x👩‍👩‍👧")
  session.send("deleteBackward")
  assert.equal(session.state.query, "x")
  session.send("deleteBackward")
  assert.equal(session.state.query, "")
})

test("a search with no matches selects nothing, and commit or release dismiss", () => {
  const session = driver(Session.create(items))
  typed(session, "qqqq")
  assert.equal(session.state.selectedIndex, null)
  assert.equal(session.send("commit").type, "dismiss")
  assert.equal(session.send("triggerReleased").type, "dismiss")
})

test("results are ranked by match score, and equal matches keep input order", () => {
  const titles = ["report draft", "port", "Unrelated"]
  const ranked = driver(Session.create(titles.map((title, i) => item(i + 1, "Editor", title))))
  typed(ranked, "port")
  assert.deepEqual(ids(ranked.state), ["window:2", "window:1"])

  const tied = driver(Session.create([3, 1, 2].map((n) => item(n, "A", "same"))))
  typed(tied, "same")
  assert.deepEqual(ids(tied.state), ["window:3", "window:1", "window:2"])
})

// --- Lock, cancel, activate and the Later effects ------------------------

test("Space locks open once; releasing the trigger while locked does nothing", () => {
  const session = driver(Session.create(items))
  assert.equal(session.send("lockOpen").type, "refresh")
  assert.equal(session.send("lockOpen").type, "none")
  assert.equal(session.send("triggerReleased").type, "none")
  assert.equal(session.send("commit").item.id, "window:2")
})

test("Escape clears a search and reselects, keeps the lock, then dismisses", () => {
  const session = driver(Session.create(items, { locked: true }))
  typed(session, "mail")
  assert.equal(session.send("cancel").type, "refresh")
  assert.equal(session.state.query, "")
  assert.equal(session.state.selectedIndex, 1)
  assert.equal(session.state.isLocked, true)
  assert.equal(session.send("cancel").type, "dismiss")
})

test("releasing the trigger activates the selection unless locked or empty", () => {
  assert.equal(Session.handle(Session.create(items), "triggerReleased").effect.item.id, "window:2")
  assert.equal(Session.handle(Session.create(items, { locked: true }), "triggerReleased").effect.type, "none")
  for (const input of ["commit", "triggerReleased"]) {
    assert.equal(Session.handle(Session.create([]), input).effect.type, "dismiss", input)
  }
})

const ALL_ACTIONS = ["close", "minimize", "toggleFullscreen", "hideApp", "quitApp", "moveToNextDisplay", "closeAppWindows", "togglePin"]
const WINDOW_ONLY_ACTIONS = ["close", "minimize", "toggleFullscreen", "moveToNextDisplay", "closeAppWindows"]

test("an action on a window with an app id is performed", () => {
  const state = Session.create([item(1, "App", "", { appId: "app" })])
  for (const action of ALL_ACTIONS) {
    const effect = Session.handle(state, { type: "action", action }).effect
    assert.deepEqual([effect.type, effect.action, effect.item.id], ["perform", action, "window:1"], action)
  }
})

test("a windowless app entry ignores window-only actions and pin, but allows hide and quit", () => {
  const state = Session.create([{ id: "app:9", pid: 9, appName: "Calculator", title: "" }])
  for (const action of [...WINDOW_ONLY_ACTIONS, "togglePin"]) {
    assert.equal(Session.handle(state, { type: "action", action }).effect.type, "none", action)
  }
  for (const action of ["quitApp", "hideApp"]) {
    assert.equal(Session.handle(state, { type: "action", action }).effect.type, "perform", action)
  }
  assert.equal(Session.handle(state, "peek").effect.type, "none")
})

test("a window without an app id cannot be pinned", () => {
  const state = Session.create([item(1)])
  assert.equal(Session.handle(state, { type: "action", action: "togglePin" }).effect.type, "none")
})

test("the focus action activates; peek and quick-select act on the visible list", () => {
  const session = driver(Session.create(items))
  assert.equal(session.send({ type: "action", action: "focus" }).type, "activate")
  assert.equal(session.send("peek").type, "peek")
  assert.equal(session.send({ type: "quickSelect", index: 3 }).item.id, "window:4")
  for (const index of [-1, 99]) assert.equal(session.send({ type: "quickSelect", index }).type, "none", String(index))
  assert.equal(Session.handle(Session.create([]), { type: "action", action: "focus" }).effect.type, "none")
})

test("an unknown input does nothing", () => {
  assert.equal(Session.handle(Session.create(items), "nonsense").effect.type, "none")
  assert.equal(Session.handle(Session.create(items), { type: "nonsense" }).effect.type, "none")
})

// --- Immutability --------------------------------------------------------

test("handle never changes the state it is given, for any input", () => {
  const searching = Session.handle(Session.create(items, { columns: 2 }), { type: "type", text: "a" }).state
  const states = [Session.create(items), Session.create(items, { columns: 2, locked: true }), searching, Session.create([])]
  const inputs = [
    ...NAVIGATION_INPUTS,
    { type: "select", index: 2 },
    { type: "type", text: "ma" },
    "deleteBackward",
    "cancel",
    "lockOpen",
    "commit",
    "triggerReleased",
    { type: "quickSelect", index: 1 },
    "peek",
    { type: "action", action: "focus" },
    { type: "action", action: "close" }
  ]
  for (const state of states) {
    const before = structuredClone(state)
    for (const input of inputs) {
      Session.handle(state, input)
      assert.deepEqual(state, before, JSON.stringify(input))
    }
  }
})

test("replaceItems never changes the state it is given", () => {
  const state = Session.handle(Session.create(items), { type: "type", text: "a" }).state
  const before = structuredClone(state)
  Session.replaceItems(state, [items[0]])
  assert.deepEqual(state, before)
})

// --- Live replacement ----------------------------------------------------

test("replacing items keeps the selection on the same item when it moves", () => {
  const session = driver(Session.create(items))
  session.send({ type: "select", index: 3 })
  session.replace([items[3], items[0], items[1]])
  assert.equal(session.state.selectedIndex, 0)
})

test("replacing items keeps the position, clamped, when the selected item is gone", () => {
  const session = driver(Session.create(items))
  session.send({ type: "select", index: 2 })
  session.replace(items.filter((i) => i.id !== "window:3"))
  assert.equal(Session.selectedItem(session.state).id, "window:4")
  session.send("last")
  session.replace(items.slice(0, 2))
  assert.equal(session.state.selectedIndex, 1)
})

test("replacing items with none selects nothing; items then return to the opening selection", () => {
  const session = driver(Session.create(items))
  session.replace([])
  assert.equal(session.state.selectedIndex, null)
  session.replace(items)
  assert.equal(session.state.selectedIndex, 1)
})

test("replacing items updates an unchanged item's contents", () => {
  const session = driver(Session.create(items))
  session.replace(items.map((i, n) => (n === 1 ? { ...i, title: "vim" } : i)))
  assert.equal(Session.selectedItem(session.state).title, "vim")
})

test("replacing items reapplies the query", () => {
  const session = driver(Session.create(items))
  typed(session, "mail")
  session.replace([...items, item(6, "Mail", "Drafts")])
  assert.deepEqual(ids(session.state), ["window:3", "window:6"])
  assert.equal(Session.selectedItem(session.state).id, "window:3")
})

// --- Search history ------------------------------------------------------

const slackAndSafari = [
  item(1, "Safari", "Apple", { appId: "safari" }),
  item(2, "Slack", "general", { appId: "slack" }),
  item(3, "Mail", "Inbox", { appId: "mail" })
]

function memoryOf(query, picked) {
  const memory = Memory.create()
  Memory.record(memory, query, picked)
  return memory
}

function afterTyping(list, text, memory) {
  return Session.handle(Session.create(list, memory ? { searchMemory: memory } : {}), { type: "type", text }).state
}

test("a past pick reorders matches but keeps the raw match", () => {
  const plain = afterTyping(slackAndSafari, "s")
  const remembered = afterTyping(slackAndSafari, "s", memoryOf("sl", slackAndSafari[1]))
  assert.deepEqual(ids(plain), ["window:1", "window:2"])
  assert.deepEqual(ids(remembered), ["window:2", "window:1"])
  assert.deepEqual(plain.visible[1].match, remembered.visible[0].match)
})

test("history never changes the empty-query order or adds non-matches", () => {
  const memory = memoryOf("sl", slackAndSafari[1])
  const initial = Session.create(slackAndSafari, { searchMemory: memory })
  assert.deepEqual(ids(initial), slackAndSafari.map((i) => i.id))
  for (let pick = 0; pick < 10; pick++) Memory.record(memory, "s", slackAndSafari[2])
  assert.ok(!ids(afterTyping(slackAndSafari, "s", memory)).includes("window:3"))
})

test("a session reads a snapshot: later picks and further typing do not alter it", () => {
  const memory = memoryOf("sl", slackAndSafari[1])
  const initial = Session.create(slackAndSafari, { searchMemory: memory })
  const snapshot = structuredClone(initial.searchMemory)
  Memory.record(memory, "s", slackAndSafari[0])
  assert.deepEqual(initial.searchMemory, snapshot)
  const searching = Session.handle(initial, { type: "type", text: "s" }).state
  assert.deepEqual(ids(Session.replaceItems(searching, slackAndSafari)), ids(searching))
  assert.deepEqual(Session.handle(searching, "commit").state.searchMemory, snapshot)
})

test("a boost cannot lift a weak match over a strong one", () => {
  const strong = [item(1, "Terminal", "zsh"), item(2, "Notes", "the error message")]
  const memory = memoryOf("term", strong[1])
  assert.deepEqual(ids(afterTyping(strong, "term", memory)), ["window:1", "window:2"])
})

test("history favours the picked window among siblings and survives relaunch", () => {
  const siblings = [item(1, "Code", "server.swift", { appId: "code" }), item(2, "Code", "client.swift", { appId: "code" })]
  assert.equal(afterTyping(siblings, "swift", memoryOf("swift", siblings[1])).visible[0].item.id, "window:2")
  const relaunched = memoryOf("s", item(99, "Slack", "old", { appId: "slack" }))
  assert.equal(afterTyping(slackAndSafari, "s", relaunched).visible[0].item.id, "window:2")
})

// --- Both loading paths ----------------------------------------------------

test("loaded the way QML does, through .import, it behaves the same", () => {
  const inQml = qml("Session.js")
  const typedState = inQml.handle(inQml.create([{ id: "window:1", appName: "Editor", title: "Café" }]), { type: "type", text: "cafe" })
  assert.equal(typedState.state.visible.length, 1)
  assert.equal(inQml.handle(typedState.state, "commit").effect.item.id, "window:1")
})
