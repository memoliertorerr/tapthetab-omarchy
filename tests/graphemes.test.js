// lib/Graphemes.js: the small segmenter and folding that stand in for Swift's
// Character and String.folding (port-spec.md section 0).

const test = require("node:test")
const assert = require("node:assert/strict")
const { node, qml } = require("./helpers/qml-loader.js")

const Graphemes = node("Graphemes.js")

// Each of these is one cluster; a following "x" must stay separate.
const SINGLE_CLUSTERS = [
  ["combining accent", "é"],
  ["ZWJ family", "👩‍👩‍👧"],
  ["skin tone", "👍🏽"],
  ["flag", "🇮🇹"],
  ["CRLF", "\r\n"],
  ["variation selector", "✈️"],
  ["plain emoji", "😀"],
  ["keycap", "1️⃣"]
]

test("split keeps each of these as one cluster", () => {
  for (const [name, cluster] of SINGLE_CLUSTERS) {
    assert.deepEqual(Graphemes.split(cluster + "x"), [cluster, "x"], name)
  }
})

test("split pairs regional indicators two at a time", () => {
  assert.deepEqual(Graphemes.split("🇮🇹🇫🇷🇺"), ["🇮🇹", "🇫🇷", "🇺"])
})

test("split joins after a ZWJ only for emoji, so Indic text keeps its letters apart", () => {
  assert.deepEqual(Graphemes.split("a‍b"), ["a‍", "b"])
  assert.deepEqual(Graphemes.split("👨‍❤️‍👨"), ["👨‍❤️‍👨"])
})

test("split of nothing is nothing, and a lone mark stands alone", () => {
  assert.deepEqual(Graphemes.split(""), [])
  assert.deepEqual(Graphemes.split("́a"), ["́", "a"])
})

// Folding drops case, accents and width, and stays one element per cluster.
const FOLD_CASES = [
  ["Ça Été ÅNGSTRÖM", "ca ete angstrom"],
  ["Ünïcödé ＡＢ", "unicode ab"],
  ["ÜBER ＡＢ", "uber ab"]
]

test("fold maps case, accents and fullwidth letters to plain lowercase", () => {
  for (const [input, expected] of FOLD_CASES) {
    assert.equal(Graphemes.fold(input).join(""), expected, input)
  }
})

test("fold gives one element per cluster", () => {
  assert.equal(Graphemes.fold("Ñé").length, 2)
  assert.equal(Graphemes.fold("👩‍👩‍👧x").length, 2)
  assert.equal(Graphemes.foldCharacter("é"), "e")
})

test("fold works the same without String.prototype.normalize", () => {
  const withoutNormalize = qml("Graphemes.js", "String.prototype.normalize = undefined")
  for (const [input, expected] of FOLD_CASES) {
    assert.equal(withoutNormalize.fold(input).join(""), expected, input)
  }
  assert.equal(withoutNormalize.fold("Ñé").length, 2)
})

test("whitespace, trim and tokens treat U+0085 and runs of space alike", () => {
  assert.equal(Graphemes.whitespace(" "), true)
  assert.equal(Graphemes.whitespace("\u0085"), true)
  assert.equal(Graphemes.whitespace("a"), false)
  assert.equal(Graphemes.trim(" \t a b\n"), "a b")
  assert.deepEqual(Graphemes.tokens("  chrome \t github\n"), ["chrome", "github"])
  assert.deepEqual(Graphemes.tokens("  \t "), [])
})

test("letter and number cover ASCII, accented, CJK and non-ASCII digits", () => {
  for (const cluster of ["a", "Z", "é", "漢", "か", "한"]) assert.equal(Graphemes.letter(cluster), true, cluster)
  for (const cluster of ["1", "٣", "५", "９"]) assert.equal(Graphemes.number(cluster), true, cluster)
  for (const cluster of ["-", " ", "1"]) assert.equal(Graphemes.letter(cluster), false, cluster)
  for (const cluster of ["a", "-", "漢"]) assert.equal(Graphemes.number(cluster), false, cluster)
})

test("stroked letters fold the same with and without String.prototype.normalize", () => {
  const withoutNormalize = qml("Graphemes.js", "String.prototype.normalize = undefined")
  for (const [text, expected] of [["Łódź", "lodz"], ["Øresund", "oresund"], ["Đakovo", "dakovo"], ["ıi", "ii"]]) {
    assert.equal(Graphemes.fold(text).join(""), expected, text)
    assert.equal(withoutNormalize.fold(text).join(""), expected, `${text} without normalize`)
  }
})
