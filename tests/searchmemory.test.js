// lib/SearchMemory.js against port-spec.md section 5 (SearchMemoryTests.swift).

const test = require("node:test")
const assert = require("node:assert/strict")
const { node, qml } = require("./helpers/qml-loader.js")

const Memory = node("SearchMemory.js")

const slack = { id: "window:10", pid: 2, appName: "Slack", appId: "com.slack" }
const slackSibling = { ...slack, id: "window:11" }
const safari = { id: "window:20", appName: "Safari", appId: "com.safari" }

// A memory where `query` was picked for each given item, in order.
function remembered(query, ...items) {
  const memory = Memory.create()
  for (const item of items) Memory.record(memory, query, item)
  return memory
}

test("a new memory holds 256 entries and boosts nothing", () => {
  const memory = Memory.create()
  assert.equal(memory.capacity, 256)
  assert.equal(Memory.boost(memory, "sl", slack), 0)
})

test("empty or whitespace queries are never recorded", () => {
  const memory = Memory.create()
  for (const query of ["", " \t "]) Memory.record(memory, query, slack)
  assert.equal(memory.entries.length, 0)
})

// One pick of "sl" for the Slack window: base 30, recency 100%.
//   same query:   relation 100%        -> 30  window tier + 15 app tier = 45
//   "s" or "slac": 50 + 50*2/4 = 75%   -> 22  window tier + 11 app tier = 33
//   "slack":       50 + 50*2/5 = 70%   -> 21  window tier + 10 app tier = 31
const SL_PICK_BOOSTS = [
  ["sl", 45],
  ["s", 33],
  ["slac", 33],
  ["slack", 31],
  ["ma", 0],
  ["ls", 0],
  ["", 0],
  ["  ", 0]
]

test("one pick boosts the same and related queries by the section 2 formula", () => {
  const memory = remembered("sl", slack)
  for (const [query, expected] of SL_PICK_BOOSTS) {
    assert.equal(Memory.boost(memory, query, slack), expected, JSON.stringify(query))
  }
})

test("a sibling window of the same app gets the app tier only", () => {
  const memory = remembered("sl", slack)
  assert.equal(Memory.boost(memory, "sl", slackSibling), 15)
  assert.equal(Memory.boost(memory, "sl", { ...slackSibling, pid: 77, appId: "COM.SLACK" }), 15)
})

test("another app gets nothing, even with a reused window id", () => {
  const memory = remembered("sl", slack)
  assert.equal(Memory.boost(memory, "sl", safari), 0)
  assert.equal(Memory.boost(memory, "sl", { ...slack, appId: "other" }), 0)
})

test("queries are normalized: folded, trimmed, whitespace collapsed", () => {
  assert.equal(Memory.normalize("  Ünïcödé   ＡＢ \n x "), "unicode ab x")
  const memory = Memory.create()
  Memory.record(memory, "  Café   Menu ", slack)
  Memory.record(memory, "CAFÉ\tMENU", slack)
  assert.equal(memory.entries.length, 1)
  assert.equal(Memory.boost(memory, "cafe menu", slack), 54)
})

test("an item without an app id is keyed by its folded, trimmed app name", () => {
  const memory = remembered("to", { id: "window:1", appName: " Tool " })
  assert.equal(Memory.boost(memory, "to", { id: "window:2", appName: "tool" }), 15)
  assert.equal(Memory.boost(memory, "to", { id: "window:3", appName: "Tools" }), 0)
  assert.equal(Memory.appKey({ id: "window:1", appName: " Tool " }), "name:tool")
  assert.equal(Memory.appKey({ id: "window:1", appName: "X", appId: " Com.A " }), "bundle:com.a")
})

test("a windowless app entry and a window of the same app share the app tier", () => {
  const calculator = { id: "app:7", appName: "Calculator", appId: "calc" }
  const memory = remembered("calc", calculator)
  assert.equal(Memory.boost(memory, "calc", calculator), 45)
  assert.equal(Memory.boost(memory, "calc", { ...calculator, id: "window:5" }), 15)
})

test("relationPercent needs one query to be a prefix of the other, by grapheme", () => {
  assert.equal(Memory.relationPercent("sa", "sl"), null)
  assert.equal(Memory.relationPercent("sl", "sl"), 100)
  assert.equal(Memory.relationPercent("s", "sl"), 75)
  assert.equal(Memory.relationPercent("👩‍👩‍👧x", "👩‍👩‍👧"), 75)
  assert.equal(Memory.relationPercent("", ""), null)
})

test("repeated picks raise the boost to the 90 maximum", () => {
  const memory = Memory.create()
  const boosts = []
  for (let pick = 0; pick < 8; pick++) {
    Memory.record(memory, "sl", slack)
    boosts.push(Memory.boost(memory, "sl", slack))
  }
  assert.deepEqual(boosts, [45, 54, 63, 72, 81, 90, 90, 90])
  assert.equal(Memory.maximumBoost, 90)
})

test("a boost fades as other picks age it, down to a 30 percent floor", () => {
  const memory = remembered("sl", slack)
  Memory.record(memory, "sa", safari)
  // age 1: recency 98% -> floor(30 * 100 * 98 / 10000) = 29, plus 14 app tier.
  assert.equal(Memory.boost(memory, "sl", slack), 43)
  for (let pick = 0; pick < 100; pick++) Memory.record(memory, "sa", safari)
  // floor: floor(30 * 100 * 30 / 10000) = 9, plus 4.
  assert.equal(Memory.boost(memory, "sl", slack), 13)
})

test("the best related entry wins; entries are never summed", () => {
  const memory = remembered("s", slack)
  Memory.record(memory, "sl", slack)
  assert.equal(Memory.boost(memory, "sl", slack), 45)
  const related = Memory.create()
  for (const query of ["s", "sl", "sla", "slac", "slack"]) {
    for (let pick = 0; pick < 10; pick++) Memory.record(related, query, slack)
  }
  for (const query of ["s", "sl", "sla", "slac", "slack", "slack general"]) {
    assert.ok(Memory.boost(related, query, slack) <= 90, query)
  }
})

test("the more recent of two picks wins, the more frequent of five beats one", () => {
  const recent = remembered("s", safari, slack)
  assert.ok(Memory.boost(recent, "s", slack) > Memory.boost(recent, "s", safari))
  const frequent = remembered("s", safari, safari, safari, safari, safari, slack)
  assert.ok(Memory.boost(frequent, "s", safari) > Memory.boost(frequent, "s", slack))
})

test("recording the same pick again keeps one entry and counts up, even if the app changed", () => {
  const memory = remembered("s", slack)
  Memory.record(memory, "s", { ...slack, appId: "changed" })
  assert.equal(memory.entries.length, 1)
  assert.equal(memory.entries[0].count, 2)
  assert.equal(Memory.boost(memory, "s", slack), 0)
})

test("beyond capacity the least recently used entry is evicted", () => {
  const memory = Memory.create(2)
  for (const name of ["a", "b", "a", "c"]) Memory.record(memory, name, { id: name, appName: name })
  assert.equal(memory.entries.length, 2)
  assert.equal(Memory.boost(memory, "b", { id: "b", appName: "b" }), 0)
  assert.ok(Memory.boost(memory, "a", { id: "a", appName: "a" }) > 0)
  assert.ok(Memory.boost(memory, "c", { id: "c", appName: "c" }) > 0)
})

test("the default capacity bounds memory at 256 entries", () => {
  const memory = Memory.create()
  for (let n = 0; n < 300; n++) Memory.record(memory, "q" + n, { id: String(n), appName: "App" })
  assert.equal(memory.entries.length, 256)
})

test("a capacity of zero or less disables recording", () => {
  for (const capacity of [0, -5]) {
    const memory = Memory.create(capacity)
    Memory.record(memory, "s", slack)
    assert.equal(memory.entries.length, 0, `capacity ${capacity}`)
  }
})

test("a scorer is a snapshot and gives the same numbers as boost", () => {
  const memory = remembered("s", safari, slack)
  const snapshot = Memory.scorer(memory, "s")
  for (const item of [slack, slackSibling, safari]) assert.equal(snapshot(item), Memory.boost(memory, "s", item))
  const before = snapshot(slack)
  Memory.record(memory, "s", slack)
  assert.equal(snapshot(slack), before)
})

test("the same picks always build the same memory", () => {
  const build = () => remembered("sl", slack, safari, slack)
  assert.deepEqual(build(), build())
})

test("loaded the way QML does, through .import, it boosts the same", () => {
  const inQml = qml("SearchMemory.js")
  const memory = inQml.create()
  inQml.record(memory, "sl", slack)
  assert.equal(inQml.boost(memory, "sl", slack), 45)
  assert.equal(inQml.normalize("  Ünïcödé   ＡＢ \n x "), "unicode ab x")
})
