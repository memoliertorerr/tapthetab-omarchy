// lib/Fuzzy.js against the vectors in port-spec.md section 5 (from
// FuzzyMatcherTests.swift) plus exact scores worked out from section 2.

const test = require("node:test")
const assert = require("node:assert/strict")
const { node, qml } = require("./helpers/qml-loader.js")

const Fuzzy = node("Fuzzy.js")
const Graphemes = node("Graphemes.js")

function match(query, title = "", appName = "App") {
  return Fuzzy.match(query, { title, appName })
}

// The graphemes of text at the given indices, joined: what a highlight shows.
function highlighted(text, indices) {
  const clusters = Graphemes.split(text)
  return indices.map((index) => clusters[index]).join("")
}

const NO_MATCH = { score: 0, titleIndices: [], appNameIndices: [] }

test("an empty or whitespace query matches everything with score 0 and no highlights", () => {
  for (const query of ["", "  \t "]) {
    assert.deepEqual(match(query, "Anything"), NO_MATCH, JSON.stringify(query))
  }
})

test("matching ignores case, accents and width", () => {
  const cases = [
    ["README", "readme.md"],
    ["readme", "README.md"],
    ["café", "Cafe Menu"],
    ["cafe", "Café Menu"],
    ["ÜBER", "uber eats"],
    ["ab", "ＡＢ cd"]
  ]
  for (const [query, title] of cases) assert.ok(match(query, title), `${query} vs ${title}`)
  assert.equal(highlighted("Café Menu", match("cafe", "Café Menu").titleIndices), "Café")
})

test("a query that cannot match returns null", () => {
  const cases = [
    ["xyz", "Apple", "Safari"],
    ["safarisafari", "Safari", "Safari"],
    ["cba", "abc", "X"],
    ["chrome zebra", "GitHub", "Google Chrome"]
  ]
  for (const [query, title, appName] of cases) {
    assert.equal(match(query, title, appName), null, `${query} vs ${title} / ${appName}`)
  }
})

test("tokens match the title or the app name independently, in any order", () => {
  const title = "GitHub - Pull requests"
  const appName = "Google Chrome"
  const result = match("chrome github", title, appName)
  assert.equal(highlighted(appName, result.appNameIndices), "Chrome")
  assert.equal(highlighted(title, result.titleIndices), "GitHub")
  assert.deepEqual(match("github chrome", title, appName), result)
  assert.deepEqual(match("chrome    github", title, appName), result)
})

test("better matches rank higher", () => {
  const cases = [
    ["note", "notes", "nxoxtxe"],
    ["port", "my port", "my report"],
    ["mail", "mail box", "box mail"],
    ["view", "MainViewController", "Mainviewcontroller"],
    ["doc", "doc", "doc " + "z".repeat(60)]
  ]
  for (const [query, better, worse] of cases) {
    assert.ok(match(query, better).score > match(query, worse).score, `${query}: ${better} > ${worse}`)
  }
  assert.ok(match("saf", "Untitled", "Safari").score > match("saf", "Safari", "Untitled").score, "app-name bonus")
  assert.ok(match("termi", "terminal").score > match("ter", "terminal").score, "longer token scores more")
})

test("exact scores follow the section 2 formulas", () => {
  // Contiguous: 100 + 12 per grapheme + 30 at field start + 25 at a word start
  // + 10 when the match ends a word. "note" in "notes" ends mid-word: no +10.
  assert.equal(match("note", "notes").score, 100 + 48 + 30 + 25)
  // "log" in "blog - Log in": index 7 starts a word and ends before a space.
  // The 13-grapheme title costs one point.
  assert.equal(match("log", "blog - Log in", "X").score, 100 + 36 + 25 + 10 - 1)
  // App-name hits get +8: "saf" in "Safari" is 100 + 36 + 30 + 25, no word end.
  assert.equal(match("saf", "Untitled", "Safari").score, 100 + 36 + 30 + 25 + 8)
  // Subsequence "gp" in "Git Pull": g is a word start at 0 (10 + 18 + 15);
  // p is a word start after 3 skipped graphemes (10 + 18 - 3).
  assert.equal(match("gp", "Git Pull", "X").score, 43 + 25)
  // Repeated tokens add up; the title-length penalty is taken once.
  assert.equal(match("note note", "notes").score, 2 * 203)
})

test("the title-length penalty is one point per 12 graphemes, capped at 120", () => {
  const base = 100 + 12 + 30 + 25
  assert.equal(match("a", "a" + "b".repeat(11), "X").score, base - 1)
  assert.equal(match("a", "a" + "b".repeat(23), "X").score, base - 2)
  assert.equal(match("a", "a" + "b".repeat(239), "X").score, base - 10)
  assert.equal(match("a", "a" + "b".repeat(1000), "X").score, base - 10)
})

test("contiguous matches keep the best occurrence", () => {
  assert.deepEqual(match("log", "blog - Log in", "X").titleIndices, [7, 8, 9])
})

test("subsequence matches prefer word starts, with the section 2 exceptions", () => {
  const cases = [
    // Word start preferred over an earlier plain hit.
    ["gp", "Git Pull", [0, 4]],
    ["bq", "xbaq Bzq", [5, 7]],
    // The later word-start b leaves no a to match, so the jump is abandoned.
    ["ba", "xbya b", [1, 3]],
    // A plain hit directly after the previous match beats a later word start.
    ["abc", "xaby Bc", [1, 2, 6]]
  ]
  for (const [query, title, indices] of cases) {
    assert.deepEqual(match(query, title, "X").titleIndices, indices, `${query} vs ${title}`)
  }
})

test("highlight offsets count graphemes of the display title", () => {
  assert.deepEqual(match("photos", "👩‍👩‍👧 family photos", "X").titleIndices, [9, 10, 11, 12, 13, 14])
  assert.deepEqual(match("notes", "   Notes", "X").titleIndices, [0, 1, 2, 3, 4])
})

test("highlights are unique and sorted when tokens overlap", () => {
  assert.deepEqual(match("git github", "GitHub", "X").titleIndices, [0, 1, 2, 3, 4, 5])
})

// query, title, app name, then the text highlighted in each label.
const DUAL_HIGHLIGHTS = [
  // An untitled window shows its app name as title: both labels highlight.
  ["fin", "", "Finder", "Fin", "Fin"],
  ["calc", "", "Calculator", "Calc", "Calc"],
  // A contiguous hit in the losing field is highlighted too...
  ["slack", "Slack — general", "Slack", "Slack", "Slack"],
  ["notes", "Notes", "Sticky Notes", "Notes", "Notes"],
  // ...a scattered one is not.
  ["mail", "my alpha in lab", "Mail", "", "Mail"],
  ["slack design", "Slack huddle — design", "Slack", "Slackdesign", "Slack"]
]

test("a token is highlighted in the losing field only when its hit is contiguous", () => {
  for (const [query, title, appName, titleText, appNameText] of DUAL_HIGHLIGHTS) {
    const result = match(query, title, appName)
    const shownTitle = Fuzzy.displayTitle({ title, appName })
    assert.equal(highlighted(shownTitle, result.titleIndices), titleText, `${query}: title`)
    assert.equal(highlighted(appName, result.appNameIndices), appNameText, `${query}: app name`)
  }
})

test("only the better field scores, and a tie goes to the title", () => {
  assert.equal(match("slack", "Slack — general", "Slack").score, match("slack", "Inbox — general", "Slack").score)
  assert.equal(highlighted("Activity Monitor", match("acmo", "Activity Monitor", "X").titleIndices).toLowerCase(), "acmo")
  assert.equal(highlighted("Inbox — Mail", match("inbox", "Inbox — Mail", "Mail").titleIndices), "Inbox")
})

test("when title and app name score exactly alike, the title wins the highlight", () => {
  // Both are scattered "a...b" matches. Title "axb": 43 for a, then 10 - 1 for b
  // = 52. App name "axxxxxxxxxb": 43 + 10 - 9 = 44, plus the app bonus 8 = 52.
  const result = match("ab", "axb", "axxxxxxxxxb")
  assert.equal(result.score, 52)
  assert.deepEqual(result.titleIndices, [0, 2])
  assert.deepEqual(result.appNameIndices, [])
})

test("displayTitle trims the title and falls back to the untrimmed app name", () => {
  assert.equal(Fuzzy.displayTitle({ title: "  Notes \n", appName: "App" }), "Notes")
  assert.equal(Fuzzy.displayTitle({ title: " \t", appName: " Finder " }), " Finder ")
  assert.equal(Fuzzy.displayTitle({ appName: "Finder" }), "Finder")
})

test("isContiguous is true only for one unbroken run", () => {
  const cases = [[[3], true], [[3, 4, 5], true], [[3, 5], false], [[], false]]
  for (const [indices, expected] of cases) assert.equal(Fuzzy.isContiguous(indices), expected, JSON.stringify(indices))
})

test("isWordStart: start, after a separator, camelCase, and letter-to-digit", () => {
  const clusters = Graphemes.split("foo-barBaz 9x")
  for (const index of [0, 4, 7, 11]) assert.equal(Fuzzy.isWordStart(clusters, index), true, `index ${index}`)
  for (const index of [1, 5, 8, 12]) assert.equal(Fuzzy.isWordStart(clusters, index), false, `index ${index}`)
})

test("loaded the way QML does, through .import, it gives the same results", () => {
  const inQml = qml("Fuzzy.js")
  const cases = [["chrome github", "GitHub - Pull requests", "Google Chrome"], ["bq", "xbaq Bzq", "X"], ["zzz", "none", "X"]]
  for (const [query, title, appName] of cases) {
    const item = { title, appName }
    assert.deepEqual(JSON.parse(JSON.stringify(inQml.match(query, item))), Fuzzy.match(query, item), query)
  }
})
