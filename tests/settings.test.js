// lib/Settings.js against port-spec.md sections 4 and 5 (ConfigurationTests.swift):
// lenient decoding and validation, for the Linux-applicable subset.

const test = require("node:test")
const assert = require("node:assert/strict")
const { node } = require("./helpers/qml-loader.js")

const Settings = node("Settings.js")

function delayOf(input) {
  return Settings.decode({ appearance: { showDelayMilliseconds: input } }).appearance.showDelayMilliseconds
}

function previewPercentOf(input) {
  return Settings.decode({ appearance: { largePreviewPercent: input } }).appearance.largePreviewPercent
}

test("empty input, as an object or JSON text, decodes to the defaults", () => {
  assert.deepEqual(Settings.decode({}), Settings.defaults())
  assert.deepEqual(Settings.decode("{}"), Settings.defaults())
})

test("defaults returns a fresh object each time", () => {
  const first = Settings.defaults()
  first.filters.excludedAppIds.push("x")
  first.behavior.wrapAround = false
  assert.deepEqual(Settings.defaults().filters.excludedAppIds, [])
  assert.equal(Settings.defaults().behavior.wrapAround, true)
})

test("a bad field falls back alone, and a wrong-type section falls back whole", () => {
  const decoded = Settings.decode({
    future: 1,
    appearance: { style: "purple", size: "large" },
    behavior: { wrapAround: "yes", searchEnabled: false },
    filters: "none"
  })
  assert.equal(decoded.appearance.style, "grid", "unknown enum value resets only that field")
  assert.equal(decoded.appearance.size, "large")
  assert.equal(decoded.behavior.wrapAround, true, "wrong-type boolean resets")
  assert.equal(decoded.behavior.searchEnabled, false, "a valid field next to a bad one is kept")
  assert.deepEqual(decoded.filters, Settings.defaults().filters)
})

test("a boolean setting accepts only true or false", () => {
  for (const bad of ["true", 1, null, [], {}, "yes"]) {
    const decoded = Settings.decode({ appearance: { showPreviews: bad, showAppName: false } })
    assert.equal(decoded.appearance.showPreviews, false, JSON.stringify(bad))
    assert.equal(decoded.appearance.showAppName, false, JSON.stringify(bad))
  }
})

test("a root that is not an object throws from decode and gives defaults from validate", () => {
  for (const bad of [[], null, 1, true, "[]", "null", "{"]) {
    assert.throws(() => Settings.decode(bad), JSON.stringify(bad))
    assert.deepEqual(Settings.validate(bad), Settings.defaults(), JSON.stringify(bad))
  }
})

test("the show delay is a whole number clamped to 0..1000", () => {
  const cases = [[-50, 0], [5000, 1000], [0, 0], [1000, 1000], [1.5, 90], ["50", 90]]
  for (const [input, expected] of cases) assert.equal(delayOf(input), expected, JSON.stringify(input))
})

test("the large preview percent is clamped to 25..150", () => {
  for (const [input, expected] of [[0, 25], [500, 150], [66, 66]]) {
    assert.equal(previewPercentOf(input), expected, String(input))
  }
})

test("excluded app ids are trimmed, de-duplicated ignoring case, and keep the first spelling", () => {
  const ids = ["  com.a.App ", "", "com.b", "COM.A.APP", 12, null]
  assert.deepEqual(Settings.decode({ filters: { excludedAppIds: ids } }).filters.excludedAppIds, ["com.a.App", "com.b"])
  assert.deepEqual(Settings.decode({ filters: { excludedAppIds: "com.a" } }).filters.excludedAppIds, [])
})

test("decoding settings that were encoded gives them back", () => {
  const original = Settings.defaults()
  original.behavior.wrapAround = false
  original.appearance.style = "list"
  original.filters.excludedAppIds = ["com.a"]
  assert.deepEqual(Settings.decode(JSON.stringify(original)), original)
})
