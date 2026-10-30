// lib/Keys.js against port-spec.md section 5 (KeyRouterTests.swift), adapted to
// logical Linux key names.

const test = require("node:test")
const assert = require("node:assert/strict")
const { node, qml } = require("./helpers/qml-loader.js")

const Keys = node("Keys.js")

function route(key, text, modifiers = [], options = {}, searching = false) {
  return Keys.route({ key, text, modifiers }, options, searching)
}

const NAVIGATION = [
  ["Tab", "next"],
  ["Left", "moveLeft"],
  ["Right", "moveRight"],
  ["Up", "moveUp"],
  ["Down", "moveDown"],
  ["Home", "first"],
  ["PageUp", "first"],
  ["End", "last"],
  ["PageDown", "last"],
  ["Return", "commit"],
  ["Enter", "commit"],
  ["KeypadEnter", "commit"],
  ["Escape", "cancel"],
  ["Backspace", "deleteBackward"],
  ["Delete", "deleteBackward"]
]

test("navigation keys map to their session inputs", () => {
  for (const [key, type] of NAVIGATION) assert.deepEqual(route(key), { type }, key)
})

test("Shift+Tab goes back", () => {
  assert.deepEqual(route("Tab", "\t", ["shift"]), { type: "previous" })
})

test("the trigger key cycles, with Shift backwards, even when it is a letter, Space, an arrow or a digit", () => {
  for (const triggerKey of ["`", "a", "Space", "Left", "1"]) {
    assert.deepEqual(route(triggerKey, triggerKey, [], { triggerKey }), { type: "next" }, triggerKey)
    assert.deepEqual(route(triggerKey, triggerKey, ["shift"], { triggerKey }), { type: "previous" }, triggerKey)
  }
})

test("Tab still cycles when the trigger is another key", () => {
  assert.deepEqual(route("Tab", null, [], { triggerKey: "`" }), { type: "next" })
  assert.deepEqual(route("Tab", null, ["shift"], { triggerKey: "`" }), { type: "previous" })
})

test("Space locks the switcher open only while the search is empty", () => {
  assert.deepEqual(route("Space", " "), { type: "lockOpen" })
  assert.deepEqual(route("Space", " ", [], {}, true), { type: "type", text: " " })
  assert.deepEqual(route("Space", " ", [], { searchEnabled: false }), { type: "lockOpen" })
})

test("Shift+Space peeks when peek is enabled and is otherwise ignored", () => {
  assert.deepEqual(route("Space", null, ["shift"], { peekEnabled: true }, true), { type: "peek" })
  assert.deepEqual(route("Space", null, ["shift"], { peekEnabled: true }), { type: "peek" })
  assert.equal(route("Space", " ", ["shift"]), null)
})

test("printable single graphemes are typed", () => {
  for (const text of ["w", "1", ".", "+", "é", "A", "👩‍👩‍👧"]) {
    assert.deepEqual(route("other", text), { type: "type", text }, text)
  }
})

test("missing, empty, multi-grapheme and invisible text is ignored", () => {
  const ignored = [
    ["missing", null],
    ["empty", ""],
    ["two graphemes", "ab"],
    ["control code", "\u0007"],
    ["private use", ""],
    ["no-break space", " "],
    ["newline", "\n"],
    ["zero-width space", "​"]
  ]
  for (const [name, text] of ignored) assert.equal(route("other", text), null, name)
})

test("Control or Super blocks typing unless the trigger already holds it", () => {
  for (const modifier of ["control", "super"]) {
    assert.equal(route("s", "s", [modifier]), null, `${modifier} alone`)
    assert.deepEqual(route("s", "s", [modifier], { triggerModifiers: [modifier] }), { type: "type", text: "s" }, `${modifier} as trigger`)
    assert.equal(route("s", "s", ["alt", modifier], { triggerModifiers: ["alt"] }), null, `extra ${modifier}`)
  }
})

test("extra Alt does not block typing", () => {
  assert.deepEqual(route("s", "s", ["alt"]), { type: "type", text: "s" })
})

test("with search disabled, text and deleting are ignored", () => {
  for (const key of ["a", "Backspace", "Delete"]) {
    assert.equal(route(key, "a", [], { searchEnabled: false }), null, key)
  }
})

const ACTIONS = [
  ["W", "close"],
  ["M", "minimize"],
  ["F", "toggleFullscreen"],
  ["H", "hideApp"],
  ["Q", "quitApp"],
  ["D", "moveToNextDisplay"],
  ["X", "closeAppWindows"],
  ["P", "togglePin"]
]

test("Shift+letter is a window action only when actions are enabled, else it types", () => {
  const enabled = { actionsEnabled: true, searchEnabled: false }
  for (const [text, action] of ACTIONS) {
    assert.deepEqual(route(text, text, ["shift", "alt"], enabled), { type: "action", action }, text)
    assert.equal(route(text, text, ["shift", "control"], { actionsEnabled: true }), null, `${text} with Control`)
    assert.deepEqual(route(text, text, ["shift"]), { type: "type", text }, `${text} typed`)
  }
})

test("loaded the way QML does, through .import, it routes the same", () => {
  const inQml = qml("Keys.js")
  const presses = [["Tab", "\t", ["shift"]], ["s", "s", []], ["s", "s", ["control"]], ["Space", " ", []]]
  for (const [key, text, modifiers] of presses) {
    const press = { key, text, modifiers }
    assert.deepEqual(JSON.parse(JSON.stringify(inQml.route(press, {}, false))), Keys.route(press, {}, false), key)
  }
})
