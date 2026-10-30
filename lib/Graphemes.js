// Text helpers for window titles and queries: grapheme splitting, folding and
// character classes. Ports the Character-based text handling that
// ../tapthetab/Sources/TapTheTabCore/FuzzyMatcher.swift relies on (Swift's
// Character is a grapheme cluster), without Intl or Unicode property escapes,
// which port-spec.md section 0 says QV4 may not have.
//
// The segmenter is a window-title segmenter, not the full Unicode algorithm.
// It covers surrogate pairs, combining marks (U+0300 to U+036F and the
// extended, supplement and symbol blocks), variation selectors, emoji skin
// tones, ZWJ emoji sequences, regional-indicator flag pairs and CRLF. It does
// not cover Indic conjuncts, Hangul jamo sequences, spacing marks or
// prepended characters.
.pragma library

var HIGH_SURROGATE_FIRST = 0xd800
var HIGH_SURROGATE_LAST = 0xdbff
var LOW_SURROGATE_FIRST = 0xdc00
var LOW_SURROGATE_LAST = 0xdfff
var ZERO_WIDTH_JOINER = 0x200d
var REGIONAL_INDICATOR_FIRST = 0x1f1e6
var REGIONAL_INDICATOR_LAST = 0x1f1ff

// Letters that fold to a plainer one. The whole table is the fallback when
// String.prototype.normalize is missing (port-spec.md section 0); with
// normalize, it still folds the stroked letters NFD does not decompose.
// ACCENT_BASES[i] is the plain letter of ACCENT_GROUPS[i].
var ACCENT_GROUPS = [
  "àáâãäåāăą", "çćĉċč", "ďđ", "èéêëēĕėęě", "ĝğġģ", "ĥħ", "ìíîïĩīĭįı", "ĵ", "ķ",
  "ĺļľł", "ñńņň", "òóôõöøōŏő", "ŕŗř", "śŝşš", "ţťŧ", "ùúûüũūŭůűų", "ŵ", "ýÿŷ", "źżž"
]
var ACCENT_BASES = "acdeghijklnorstuwyz"

// Splits text into code points (surrogate pairs stay together), each a string
// of one or two UTF-16 units.
function codePoints(text) {
  var out = []
  for (var i = 0; i < text.length; i++) {
    var first = text.charCodeAt(i)
    var second = text.charCodeAt(i + 1)
    var isPair = first >= HIGH_SURROGATE_FIRST && first <= HIGH_SURROGATE_LAST
      && second >= LOW_SURROGATE_FIRST && second <= LOW_SURROGATE_LAST
    if (isPair) {
      out.push(text.charAt(i) + text.charAt(i + 1))
      i++
    } else {
      out.push(text.charAt(i))
    }
  }
  return out
}

// The numeric code point of one string from codePoints().
function codeOf(codePoint) {
  var first = codePoint.charCodeAt(0)
  var isPair = codePoint.length > 1 && first >= HIGH_SURROGATE_FIRST && first <= HIGH_SURROGATE_LAST
  if (!isPair) return first
  return (first - HIGH_SURROGATE_FIRST) * 1024 + codePoint.charCodeAt(1) - LOW_SURROGATE_FIRST + 0x10000
}

function isCombiningMark(code) {
  return (code >= 0x300 && code <= 0x36f)
    || (code >= 0x1ab0 && code <= 0x1aff)
    || (code >= 0x1dc0 && code <= 0x1dff)
    || (code >= 0x20d0 && code <= 0x20ff)
    || (code >= 0xfe20 && code <= 0xfe2f)
}

function isVariationSelector(code) {
  return (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0100 && code <= 0xe01ef)
}

function isSkinToneModifier(code) {
  return code >= 0x1f3fb && code <= 0x1f3ff
}

function isRegionalIndicator(code) {
  return code >= REGIONAL_INDICATOR_FIRST && code <= REGIONAL_INDICATOR_LAST
}

// A rough "can follow a ZWJ" test: emoji and the symbol blocks that hold emoji.
// After a ZWJ only these join the cluster, so Indic and Arabic text that uses
// ZWJ keeps its next letter as its own cluster, as Swift does.
function isPictographic(code) {
  return code >= 0x1f000
    || (code >= 0x2190 && code <= 0x2bff)
    || code === 0xa9 || code === 0xae || code === 0x203c || code === 0x2049
    || code === 0x2122 || code === 0x2139 || code === 0x3030 || code === 0x303d
    || code === 0x3297 || code === 0x3299
}

// Splits text into grapheme clusters, one string per cluster.
function split(text) {
  var points = codePoints(text)
  var clusters = []
  var regionalRun = 0
  for (var i = 0; i < points.length; i++) {
    var code = codeOf(points[i])
    var previous = i > 0 ? codeOf(points[i - 1]) : -1
    var joinsPrevious = clusters.length > 0 && (
      isCombiningMark(code)
      || isVariationSelector(code)
      || isSkinToneModifier(code)
      || code === ZERO_WIDTH_JOINER
      || (previous === ZERO_WIDTH_JOINER && isPictographic(code))
      || (previous === 13 && code === 10)
      // Flags come in pairs: the second indicator of each pair joins the first.
      || (isRegionalIndicator(code) && regionalRun % 2 === 1)
    )
    if (joinsPrevious) clusters[clusters.length - 1] += points[i]
    else clusters.push(points[i])
    regionalRun = isRegionalIndicator(code) ? regionalRun + 1 : 0
  }
  return clusters
}

// JavaScript's \s plus U+0085, which Swift's Character.isWhitespace also counts.
function whitespace(cluster) {
  return /^[\s\u0085]+$/.test(cluster)
}

function trim(text) {
  return text.replace(/^[\s\u0085]+|[\s\u0085]+$/g, "")
}

// Splits on runs of whitespace, dropping empty pieces.
function tokens(text) {
  return trim(text).split(/[\s\u0085]+/).filter(function(token) { return token.length > 0 })
}

function narrowFullwidth(codePoint) {
  var code = codeOf(codePoint)
  // Fullwidth forms U+FF01 to U+FF5E sit 0xFEE0 above their ASCII twins.
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0)
  return codePoint
}

// Accent stripping for engines without String.prototype.normalize: lowercases,
// then swaps the first character for its plain letter.
function stripAccentsWithoutNormalize(text) {
  var lowered = text.toLowerCase()
  for (var i = 0; i < ACCENT_GROUPS.length; i++) {
    if (ACCENT_GROUPS[i].indexOf(lowered.charAt(0)) >= 0) {
      return ACCENT_BASES.charAt(i) + lowered.slice(1)
    }
  }
  return lowered
}

// Folds one grapheme for comparison: width-, accent- and case-insensitive.
// Always yields exactly one element, so match indices stay valid for
// highlighting (port-spec.md section 2, step 1).
function foldCharacter(cluster) {
  var folded = codePoints(cluster).map(narrowFullwidth).join("")
  if (typeof folded.normalize === "function") folded = folded.normalize("NFD")
  else folded = stripAccentsWithoutNormalize(folded)
  folded = codePoints(folded).filter(function(codePoint) {
    return !isCombiningMark(codeOf(codePoint))
  }).join("").toLowerCase()
  // NFD leaves stroked letters (ł, ø, đ, ħ, ŧ, ı) alone; the table folds them
  // too, so both engines agree and "lodz" finds "Łódź".
  folded = stripAccentsWithoutNormalize(folded)
  return split(folded)[0] || cluster
}

// One folded element per grapheme of text.
function fold(text) {
  return split(text).map(foldCharacter)
}

// Approximation of Character.isNumber: ASCII, Arabic-Indic, Extended
// Arabic-Indic, Devanagari and fullwidth decimal digits.
function number(cluster) {
  var code = codeOf(cluster)
  return /[0-9]/.test(cluster)
    || (code >= 0x660 && code <= 0x669)
    || (code >= 0x6f0 && code <= 0x6f9)
    || (code >= 0x966 && code <= 0x96f)
    || (code >= 0xff10 && code <= 0xff19)
}

// Approximation of Character.isLetter: any cased character, plus the Kana, CJK
// and Hangul ranges, which have no case.
function letter(cluster) {
  var code = codeOf(cluster)
  return cluster.toLowerCase() !== cluster.toUpperCase()
    || (code >= 0x3040 && code <= 0x30ff)
    || (code >= 0x3400 && code <= 0x9fff)
    || (code >= 0xac00 && code <= 0xd7af)
    || (code >= 0x20000 && code <= 0x3134f)
}

if (typeof module !== "undefined") module.exports = {split: split, fold: fold, foldCharacter: foldCharacter, whitespace: whitespace, trim: trim, tokens: tokens, letter: letter, number: number}
