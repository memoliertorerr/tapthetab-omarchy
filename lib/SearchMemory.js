// Remembers which item was picked after typing which query, so the next search
// for the same or a related query ranks that item higher. Ports
// ../tapthetab/Sources/TapTheTabCore/SearchMemory.swift; port-spec.md section 2
// ("SearchMemory") is the contract.
//
// Memory only: never serialized. State is a plain object {capacity, clock,
// entries}; an entry is {query, id, appKey, count, lastUsed}. There is no
// wall-clock time, only a counter that grows with each record, so results are
// deterministic. The session reads a snapshot; the caller records a pick when a
// searching session activates an item.
.pragma library
.import "Graphemes.js" as Graphemes

var G = typeof require === "function" ? require("./Graphemes.js") : Graphemes

var DEFAULT_CAPACITY = 256

// Points per remembered entry (spec: "SearchMemory" formula).
var BASE_POINTS = 30
var POINTS_PER_REPEAT = 6
var COUNT_SATURATION = 6
var RECENCY_DECAY_PER_PICK = 2
var RECENCY_FLOOR_PERCENT = 30

// The most a boost can be: a window-tier hit (up to 60) plus half an app-tier
// hit (up to 30). Public, so it keeps its exported name as the variable name:
// QML sees only top-level names.
var maximumBoost = 90

function create(capacity) {
  var size = capacity == null ? DEFAULT_CAPACITY : Math.max(0, Math.floor(capacity))
  return {capacity: size, clock: 0, entries: []}
}

// Folds like the matcher does (case, accents, width), trims and collapses
// whitespace to single spaces. An empty result is never recorded and never boosts.
function normalize(query) {
  return G.tokens(query).map(function(token) { return G.fold(token).join("") }).join(" ")
}

// An item's app identity, which survives its window closing or the app
// relaunching: the lowercased app id when it has one, else the folded app name.
function appKey(item) {
  var id = G.trim(item.appId || "")
  if (id) return "bundle:" + id.toLowerCase()
  return "name:" + G.fold(G.trim(item.appName)).join("")
}

function findEntry(state, query, id) {
  for (var i = 0; i < state.entries.length; i++) {
    if (state.entries[i].query === query && state.entries[i].id === id) return state.entries[i]
  }
  return null
}

function evictLeastRecentlyUsed(state) {
  state.entries.sort(function(a, b) { return a.lastUsed - b.lastUsed })
  state.entries.shift()
}

// Remembers that item was picked after typing query. Each record advances the
// clock and the entry's count, and evicts the least recently used entry beyond
// capacity. A capacity of 0 disables the memory.
function record(state, query, item) {
  var normalized = normalize(query)
  if (!normalized || !state.capacity) return
  state.clock++
  var entry = findEntry(state, normalized, item.id)
  if (!entry) {
    entry = {query: normalized, id: item.id, count: 0}
    state.entries.push(entry)
  }
  // The count carries over even if the same window's app key changed.
  entry.count++
  entry.appKey = appKey(item)
  entry.lastUsed = state.clock
  if (state.entries.length > state.capacity) evictLeastRecentlyUsed(state)
}

// How strongly a remembered query applies to the current one, as a percent, or
// null when neither is a prefix of the other (compared by grapheme):
// 50 + floor(50 * shorter / longer), so 100 for the same query.
function relationPercent(current, remembered) {
  var currentClusters = G.split(current)
  var rememberedClusters = G.split(remembered)
  var shorter = Math.min(currentClusters.length, rememberedClusters.length)
  var longer = Math.max(currentClusters.length, rememberedClusters.length)
  if (longer === 0) return null
  for (var i = 0; i < shorter; i++) {
    if (currentClusters[i] !== rememberedClusters[i]) return null
  }
  return 50 + Math.floor(50 * shorter / longer)
}

// base x relation x recency, rounded down:
//   base    = 30 + 6 per repeat pick, counting at most 6 picks (30 up to 60)
//   recency = max(30, 100 - 2 x age) percent, age = records since last use
function entryPoints(state, entry, relation) {
  var repeats = Math.min(entry.count, COUNT_SATURATION) - 1
  var base = BASE_POINTS + POINTS_PER_REPEAT * Math.max(0, repeats)
  var age = state.clock - entry.lastUsed
  var recency = Math.max(RECENCY_FLOOR_PERCENT, 100 - RECENCY_DECAY_PER_PICK * age)
  return Math.floor(base * relation * recency / 10000)
}

// Returns a function item -> boost for query. It reads the applicable entries
// once, so it is a snapshot: records made afterwards do not change it.
//
// boost = windowTier + appTier, each a maximum and never a sum:
//   windowTier = best entry with this exact item id AND the same app key
//                (a reused window id from another app earns nothing);
//   appTier    = half the best entry with the same app key (survives a new
//                window or process identity).
function scorer(state, query) {
  var normalized = normalize(query)
  var applicable = []
  if (normalized) {
    state.entries.forEach(function(entry) {
      var relation = relationPercent(normalized, entry.query)
      if (relation === null) return
      applicable.push({id: entry.id, appKey: entry.appKey, points: entryPoints(state, entry, relation)})
    })
  }
  return function(item) {
    var key = appKey(item)
    var windowTier = 0
    var appTier = 0
    applicable.forEach(function(entry) {
      if (entry.appKey !== key) return
      appTier = Math.max(appTier, entry.points)
      if (entry.id === item.id) windowTier = Math.max(windowTier, entry.points)
    })
    return windowTier + Math.floor(appTier / 2)
  }
}

function boost(state, query, item) {
  return scorer(state, query)(item)
}

if (typeof module !== "undefined") module.exports = {create: create, record: record, normalize: normalize, appKey: appKey, relationPercent: relationPercent, scorer: scorer, boost: boost, maximumBoost: maximumBoost}
