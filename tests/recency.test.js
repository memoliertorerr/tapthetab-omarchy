// lib/Recency.js against port-spec.md section 5 (RecencyTrackerTests.swift).

const test = require("node:test")
const assert = require("node:assert/strict")
const { node } = require("./helpers/qml-loader.js")

const Recency = node("Recency.js")

const windows = [1, 2, 3, 4, 5].map((n) => ({ id: "window:" + n }))

function ids(items) {
  return items.map((item) => item.id)
}

function windowIds(numbers) {
  return numbers.map((n) => "window:" + n)
}

// A tracker where the given window numbers were touched, first to last.
function touched(numbers) {
  const state = Recency.create()
  for (const n of numbers) Recency.touch(state, "window:" + n)
  return state
}

test("with nothing touched, the supplied order stands", () => {
  const state = Recency.create()
  assert.deepEqual(Recency.ordered(state, windows), windows)
  assert.equal(Recency.trackedCount(state), 0)
})

test("touched items come first, newest first", () => {
  assert.deepEqual(ids(Recency.ordered(touched([2, 4, 3]), windows)), windowIds([3, 4, 2, 1, 5]))
})

test("untouched items keep their supplied order after the touched ones", () => {
  const supplied = [4, 1, 5, 3, 2].map((n) => windows[n - 1])
  assert.deepEqual(ids(Recency.ordered(touched([5]), supplied)), windowIds([5, 4, 1, 3, 2]))
})

test("touching again moves an item to the front without adding a stamp", () => {
  const state = touched([2, 4, 3])
  Recency.touch(state, "window:2")
  assert.equal(Recency.ordered(state, windows)[0].id, "window:2")
  assert.equal(Recency.trackedCount(state), 3)
  assert.ok(Recency.stamp(state, "window:2") > Recency.stamp(state, "window:3"))
})

test("a stamp for an item that is not in the list never adds the item", () => {
  const state = touched([42])
  assert.equal(Recency.ordered(state, windows).length, 5)
  assert.deepEqual(ids(Recency.ordered(state, windows)), ids(windows))
})

test("a window and an app with the same number are different items", () => {
  const state = Recency.create()
  Recency.touch(state, "app:1")
  assert.deepEqual(ids(Recency.ordered(state, [{ id: "window:1" }, { id: "app:1" }])), ["app:1", "window:1"])
})

test("forget removes one stamp and ignores unknown ids", () => {
  const state = touched([2, 4])
  Recency.forget(state, "window:2")
  assert.equal(Recency.stamp(state, "window:2"), undefined)
  assert.equal(Recency.trackedCount(state), 1)
  const before = JSON.stringify(state)
  Recency.forget(state, "window:99")
  assert.equal(JSON.stringify(state), before)
})

test("prune keeps only the listed ids and never resets the clock", () => {
  const state = touched([2, 3, 4])
  Recency.prune(state, ["window:4", "window:9"])
  assert.equal(Recency.trackedCount(state), 1)
  assert.notEqual(Recency.stamp(state, "window:4"), undefined)
  Recency.prune(state, [])
  assert.equal(Recency.trackedCount(state), 0)
  assert.equal(state.clock, 3)
})

test("an id such as __proto__ is an ordinary id", () => {
  const state = Recency.create()
  Recency.touch(state, "__proto__")
  assert.equal(Recency.stamp(state, "__proto__"), 1)
  assert.equal(Recency.trackedCount(state), 1)
  assert.equal(Recency.stamp(state, "constructor"), undefined)
})
