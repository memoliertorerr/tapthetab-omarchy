// The fuzzy matcher behind search: scores a query against a window's title and
// app name and reports which characters matched, for highlighting. Ports
// ../tapthetab/Sources/TapTheTabCore/FuzzyMatcher.swift; port-spec.md section 2
// ("FuzzyMatcher: exact scoring") is the contract.
//
// Everything works on graphemes (Graphemes.split), never UTF-16 units, so the
// indices it returns address clusters of the display title and the app name.
.pragma library
.import "Graphemes.js" as Graphemes

var G = typeof require === "function" ? require("./Graphemes.js") : Graphemes

// Contiguous match (spec step 3).
var CONTIGUOUS_BASE = 100
var CONTIGUOUS_PER_GRAPHEME = 12
var CONTIGUOUS_AT_FIELD_START = 30
var CONTIGUOUS_AT_WORD_START = 25
var CONTIGUOUS_ENDS_WORD = 10

// Subsequence match (spec step 6).
var SUBSEQUENCE_PER_GRAPHEME = 10
var SUBSEQUENCE_AT_WORD_START = 18
var SUBSEQUENCE_FIRST_AT_FIELD_START = 15
var SUBSEQUENCE_ADJACENT = 14
var SUBSEQUENCE_MAX_GAP_PENALTY = 10

// Typing "saf" usually means Safari, so an app-name hit scores a little more
// (spec step 7).
var APP_NAME_BONUS = 8

// Shorter titles win ties: one point off per 12 graphemes, up to 120 (step 8).
var TITLE_LENGTH_CAP = 120
var TITLE_LENGTH_PER_POINT = 12

// A word starts after whitespace or any of these (spec step 4).
var WORD_SEPARATORS = "-_./\\:|()[]{}—–·,"

// What the user sees as a window's title: trimmed, falling back to the app name
// for an untitled window.
function displayTitle(item) {
  return G.trim(item.title || "") || item.appName
}

// Word starts are judged on the original, unfolded text (spec step 4): index 0,
// after a separator, lower to upper case, or a letter to a digit.
function isWordStart(clusters, index) {
  if (index === 0) return true
  var previous = clusters[index - 1]
  var current = clusters[index]
  if (G.whitespace(previous) || WORD_SEPARATORS.indexOf(previous) >= 0) return true
  var previousIsLower = previous.toLowerCase() === previous && previous.toUpperCase() !== previous
  var currentIsUpper = current.toUpperCase() === current && current.toLowerCase() !== current
  if (previousIsLower && currentIsUpper) return true
  return !G.number(previous) && G.number(current)
}

function continuesWord(clusters, index) {
  return index < clusters.length && (G.letter(clusters[index]) || G.number(clusters[index]))
}

// True when the indices form one unbroken run, i.e. the token matched as a
// substring rather than scattered.
function isContiguous(indices) {
  if (indices.length === 0) return false
  return indices[indices.length - 1] - indices[0] + 1 === indices.length
}

// Whether needle can still be matched in order inside haystack from start on.
function isSubsequence(needle, haystack, start) {
  var cursor = start
  for (var n = 0; n < needle.length; n++) {
    while (cursor < haystack.length && haystack[cursor] !== needle[n]) cursor++
    if (cursor === haystack.length) return false
    cursor++
  }
  return true
}

function occursAt(token, folded, start) {
  for (var k = 0; k < token.length; k++) {
    if (folded[start + k] !== token[k]) return false
  }
  return true
}

// Step 3: the best contiguous occurrence of token, or null. Every occurrence
// is scored; the highest wins and an equal score keeps the earliest (strict >).
function bestContiguous(token, folded, original) {
  var best = null
  for (var start = 0; start + token.length <= folded.length; start++) {
    if (!occursAt(token, folded, start)) continue
    var end = start + token.length
    var score = CONTIGUOUS_BASE + CONTIGUOUS_PER_GRAPHEME * token.length
    if (start === 0) score += CONTIGUOUS_AT_FIELD_START
    if (isWordStart(original, start)) score += CONTIGUOUS_AT_WORD_START
    // Ends a word: at the field end, or followed by something that is not a
    // letter or number.
    if (!continuesWord(original, end)) score += CONTIGUOUS_ENDS_WORD
    if (best === null || score > best.score) {
      var indices = []
      for (var k = 0; k < token.length; k++) indices.push(start + k)
      best = {score: score, indices: indices}
    }
  }
  return best
}

// Step 5: the indices of a subsequence match, or null.
//
// For each token grapheme, scan forward from the cursor. Remember the earliest
// plain (non-word-start) hit, but prefer the first word-start hit found. Two
// exceptions keep the match tight:
//   - a plain hit directly after the previous match beats a later word start;
//   - a jump to a later word start is abandoned if the rest of the token could
//     no longer be matched after it, and the plain hit is used instead.
function subsequenceIndices(token, folded, original) {
  var indices = []
  var cursor = 0
  for (var k = 0; k < token.length; k++) {
    var wordStartHit = null
    var plainHit = null
    for (var i = cursor; i < folded.length; i++) {
      if (folded[i] !== token[k]) continue
      if (isWordStart(original, i)) {
        wordStartHit = i
        break
      }
      if (plainHit === null) plainHit = i
    }
    var hit = wordStartHit
    var previousMatch = indices.length > 0 ? indices[indices.length - 1] : null
    if (plainHit !== null && previousMatch !== null && plainHit === previousMatch + 1) hit = plainHit
    var jumpsAhead = hit !== null && plainHit !== null && plainHit < hit
    if (jumpsAhead && !isSubsequence(token.slice(k + 1), folded, hit + 1)) hit = plainHit
    if (hit === null) hit = plainHit
    if (hit === null) return null
    indices.push(hit)
    cursor = hit + 1
  }
  return indices
}

// Step 6: +10 per grapheme, +18 more at a word start, +15 if the first match is
// at index 0; after the first, +14 when adjacent to the previous match and
// otherwise minus the number of skipped graphemes (at most 10). Never below 1.
function subsequenceScore(indices, original) {
  var score = 0
  for (var n = 0; n < indices.length; n++) {
    score += SUBSEQUENCE_PER_GRAPHEME
    if (isWordStart(original, indices[n])) score += SUBSEQUENCE_AT_WORD_START
    if (n > 0) {
      var skipped = indices[n] - indices[n - 1] - 1
      if (skipped === 0) score += SUBSEQUENCE_ADJACENT
      else score -= Math.min(skipped, SUBSEQUENCE_MAX_GAP_PENALTY)
    } else if (indices[n] === 0) {
      score += SUBSEQUENCE_FIRST_AT_FIELD_START
    }
  }
  return Math.max(score, 1)
}

// Scores one folded token against one field, or null when it cannot match.
// folded and original are the same field, folded and as typed; they have the
// same length because folding is one element per grapheme.
function score(token, folded, original) {
  if (token.length === 0 || token.length > folded.length) return null
  // A contiguous occurrence always wins; subsequence matching is only tried
  // when there is none (step 3).
  var contiguous = bestContiguous(token, folded, original)
  if (contiguous) return contiguous
  var indices = subsequenceIndices(token, folded, original)
  if (indices === null) return null
  return {score: subsequenceScore(indices, original), indices: indices}
}

function sortedUnique(numbers) {
  return numbers.filter(function(n, i) { return numbers.indexOf(n) === i }).sort(function(a, b) { return a - b })
}

// Matches query against an item. Returns null when any token fails to match,
// otherwise {score, titleIndices, appNameIndices}. An empty query scores 0 with
// no highlights. Highlight indices address displayTitle(item), not item.title.
function match(query, item) {
  var tokens = G.tokens(query).map(G.fold)
  if (tokens.length === 0) return {score: 0, titleIndices: [], appNameIndices: []}

  var title = G.split(displayTitle(item))
  var appName = G.split(item.appName)
  var foldedTitle = title.map(G.foldCharacter)
  var foldedAppName = appName.map(G.foldCharacter)

  var total = 0
  var titleHits = []
  var appNameHits = []

  // Step 2: each token matches the title or the app name, whichever scores
  // higher; a token never spans the two fields.
  for (var i = 0; i < tokens.length; i++) {
    var inTitle = score(tokens[i], foldedTitle, title)
    var inAppName = score(tokens[i], foldedAppName, appName)
    if (inAppName) inAppName.score += APP_NAME_BONUS
    if (!inTitle && !inAppName) return null

    // Step 7: only the better field scores (a tie goes to the title), and it is
    // highlighted. The other field is highlighted too when its hit is
    // contiguous; a scattered hit there is usually noise and gets nothing.
    var appNameWins = inAppName && (!inTitle || inAppName.score > inTitle.score)
    if (appNameWins) {
      total += inAppName.score
      appNameHits = appNameHits.concat(inAppName.indices)
      if (inTitle && isContiguous(inTitle.indices)) titleHits = titleHits.concat(inTitle.indices)
    } else {
      total += inTitle.score
      titleHits = titleHits.concat(inTitle.indices)
      if (inAppName && isContiguous(inAppName.indices)) appNameHits = appNameHits.concat(inAppName.indices)
    }
  }

  // Step 8: an untitled window shows its app name as the title, so the two
  // labels are the same text and every hit belongs on both.
  if (title.join("") === appName.join("")) {
    titleHits = titleHits.concat(appNameHits)
    appNameHits = titleHits.slice()
  }

  var lengthPenalty = Math.floor(Math.min(title.length, TITLE_LENGTH_CAP) / TITLE_LENGTH_PER_POINT)
  return {
    score: total - lengthPenalty,
    titleIndices: sortedUnique(titleHits),
    appNameIndices: sortedUnique(appNameHits)
  }
}

if (typeof module !== "undefined") module.exports = {match: match, displayTitle: displayTitle, score: score, isWordStart: isWordStart, isContiguous: isContiguous}
