// The switcher's state machine: items, the search query, the ranked visible
// list, the selection, and what each input does. Ports
// ../tapthetab/Sources/TapTheTabCore/SwitcherSession.swift; port-spec.md
// sections 2 ("SwitcherSession recomputation and replacement") and 3 (the
// input/effect table) are the contract.
//
// No OS calls, no timers, no clocks. The caller owns presentation (including
// the show delay), closing the session on dismiss or activate, and recording a
// pick in SearchMemory when a searching session activates an item.
//
// item:    {id: "window:<address>" | "app:<pid>", pid, title, appName, appId?,
//           workspace?, monitor?, minimized?, hidden?, fullscreen?,
//           onActiveWorkspace?, focusStamp?}. Whether an item is windowless
//           comes only from its id.
// state:   {items, query, visible, selectedIndex, isLocked, columns,
//           wrapsAround, startsOnPrevious, searchMemory}. visible is a list of
//           rows {item, match}; match is null or {score, titleIndices,
//           appNameIndices}. selectedIndex is an index into visible, or null.
// input:   {type, text?, index?, action?}, or just the type as a string.
//           Types: next, previous, moveLeft, moveRight, moveUp, moveDown,
//           first, last, select, type, deleteBackward, lockOpen, commit,
//           cancel, triggerReleased, quickSelect, peek, action.
// effect:  {type: "none"} nothing changed
//          {type: "refresh"} redraw
//          {type: "activate", item} close and bring item to the front
//          {type: "dismiss"} close without doing anything
//          {type: "perform", action, item} and {type: "peek", item} are "Later"
//          features: the effect is produced, the platform dispatch is the caller's job.
//
// State is never mutated: create, handle and replaceItems return new state.
.pragma library
.import "Graphemes.js" as Graphemes
.import "Fuzzy.js" as Fuzzy
.import "SearchMemory.js" as SearchMemory

var G = typeof require === "function" ? require("./Graphemes.js") : Graphemes
var F = typeof require === "function" ? require("./Fuzzy.js") : Fuzzy
var M = typeof require === "function" ? require("./SearchMemory.js") : SearchMemory

// Pasted text loses its line breaks and tabs; the search field is one line.
var LINE_BREAK = /^[\r\n\u000b\u000c\u0085\u2028\u2029]+$/

// Actions that need a window; a windowless app entry has none to act on.
var WINDOW_ONLY_ACTIONS = ["close", "minimize", "toggleFullscreen", "moveToNextDisplay", "closeAppWindows"]

function isWindowless(item) {
  return item.id.indexOf("app:") === 0
}

function selectedItem(state) {
  if (state.selectedIndex === null || !state.visible[state.selectedIndex]) return null
  return state.visible[state.selectedIndex].item
}

function isSearching(state) {
  return state.query.length > 0
}

// A shallow copy. Everything handle and replaceItems change is replaced, never
// edited in place, so the original stays untouched.
function copyState(state) {
  var copy = {}
  for (var key in state) {
    if (Object.prototype.hasOwnProperty.call(state, key)) copy[key] = state[key]
  }
  return copy
}

// Rows for the current query. An empty query (blank counts as empty) keeps
// input order with no match. Otherwise only matching items stay, sorted by
// match score plus the search-memory boost, highest first; ties keep input
// order. The boost only ever reorders items that already matched.
function rankedRows(state) {
  if (!G.trim(state.query)) {
    return state.items.map(function(item) { return {item: item, match: null} })
  }
  var boost = M.scorer(state.searchMemory, state.query)
  var scored = []
  state.items.forEach(function(item, offset) {
    var match = F.match(state.query, item)
    if (match) scored.push({item: item, match: match, rank: match.score + boost(item), offset: offset})
  })
  scored.sort(function(a, b) { return b.rank - a.rank || a.offset - b.offset })
  return scored.map(function(row) { return {item: row.item, match: row.match} })
}

// Rebuilds visible and the selection. Selection: the id to keep if it is still
// visible; else none when nothing is visible; else the second row when the
// query is empty and the session starts on the previous window; else the first.
function recompute(state, keepingId) {
  state.visible = rankedRows(state)
  state.selectedIndex = null
  if (keepingId !== null) {
    for (var i = 0; i < state.visible.length; i++) {
      if (state.visible[i].item.id === keepingId) {
        state.selectedIndex = i
        return
      }
    }
  }
  if (state.visible.length === 0) return
  var opensOnSecond = !state.query && state.startsOnPrevious && state.visible.length > 1
  state.selectedIndex = opensOnSecond ? 1 : 0
}

// options: {locked, columns (1 for a list), wrapsAround, startsOnPrevious
// (all default as in Swift), searchMemory (a SearchMemory state), reverse}.
// reverse is the reverse trigger: it opens on the last item instead.
function create(items, options) {
  options = options || {}
  var state = {
    items: items.slice(),
    query: "",
    visible: [],
    selectedIndex: null,
    isLocked: options.locked === true,
    columns: Math.max(1, Math.floor(options.columns || 1)),
    wrapsAround: options.wrapsAround !== false,
    startsOnPrevious: options.startsOnPrevious !== false,
    // A snapshot: picks recorded later do not change this session's ranking.
    searchMemory: JSON.parse(JSON.stringify(options.searchMemory || M.create()))
  }
  recompute(state, null)
  if (options.reverse && state.visible.length > 0) state.selectedIndex = state.visible.length - 1
  return state
}

function none() {
  return {type: "none"}
}

function refresh() {
  return {type: "refresh"}
}

// Selects a valid, different index.
function select(state, index) {
  var valid = index >= 0 && index < state.visible.length && index === Math.floor(index)
  if (!valid || index === state.selectedIndex) return none()
  state.selectedIndex = index
  return refresh()
}

// Moves the selection by delta, wrapping with positive modulo or clamping.
function step(state, delta) {
  var count = state.visible.length
  if (count === 0) return none()
  if (state.selectedIndex === null) return select(state, delta >= 0 ? 0 : count - 1)
  var target = state.selectedIndex + delta
  if (state.wrapsAround) target = ((target % count) + count) % count
  else target = Math.min(Math.max(target, 0), count - 1)
  return select(state, target)
}

// Up/down in a grid: one row is `columns` items.
function stepRow(state, rows) {
  var count = state.visible.length
  var columns = state.columns
  var current = state.selectedIndex
  var target = current + rows * columns
  if (target >= 0 && target < count) return select(state, target)

  var column = current % columns
  var lastRow = Math.floor((count - 1) / columns)
  if (rows > 0) {
    // A partial last row has a gap under this column: land on the last item
    // rather than wrapping past a row that still exists.
    if (Math.floor(current / columns) < lastRow) return select(state, count - 1)
    // Already on the last row: wrap to the same column of the first row.
    if (!state.wrapsAround) return none()
    return select(state, column < count ? column : 0)
  }
  // Up from the first row: wrap to the same column of the last row, or to its
  // final item when that row is too short to have the column.
  if (!state.wrapsAround) return none()
  return select(state, Math.min(lastRow * columns + column, count - 1))
}

function moveVertically(state, direction) {
  var inGrid = state.columns > 1 && state.selectedIndex !== null
  return inGrid ? stepRow(state, direction) : step(state, direction)
}

// Appends typed text to the query and reselects the best match.
function typeText(state, text) {
  var cleaned = G.split(text).filter(function(cluster) {
    return !LINE_BREAK.test(cluster) && cluster !== "\t"
  }).join("")
  if (!cleaned) return none()
  // A leading space would match nothing useful.
  if (!state.query && G.whitespace(cleaned)) return none()
  state.query += cleaned
  recompute(state, null)
  return refresh()
}

// Deletes one grapheme. The selected item stays selected unless the query
// becomes empty, which restores the opening selection.
function deleteBackward(state, selected) {
  if (!state.query) return none()
  var clusters = G.split(state.query)
  clusters.pop()
  state.query = clusters.join("")
  recompute(state, state.query && selected ? selected.id : null)
  return refresh()
}

// Escape clears a search first and dismisses only when there is none. A locked
// session stays locked.
function cancel(state) {
  if (!state.query) return {type: "dismiss"}
  state.query = ""
  recompute(state, null)
  return refresh()
}

function activateOrDismiss(selected) {
  return selected ? {type: "activate", item: selected} : {type: "dismiss"}
}

// Window actions on the selection. Focus activates. Actions that need a window
// are ignored for a windowless entry, and pinning needs an app id.
function actionEffect(selected, action) {
  if (!selected) return none()
  if (action === "focus") return activateOrDismiss(selected)
  if (isWindowless(selected) && WINDOW_ONLY_ACTIONS.indexOf(action) >= 0) return none()
  if (action === "togglePin" && !G.trim(selected.appId || "")) return none()
  return {type: "perform", action: action, item: selected}
}

function quickSelect(state, index) {
  var valid = index >= 0 && index < state.visible.length && index === Math.floor(index)
  if (!valid) return none()
  state.selectedIndex = index
  return {type: "activate", item: state.visible[index].item}
}

// Applies one input. Returns {state, effect}; the given state is not changed.
function handle(state, input) {
  var next = copyState(state)
  var request = typeof input === "string" ? {type: input} : input
  next.columns = Math.max(1, Math.floor(next.columns || 1))
  var selected = selectedItem(next)
  var effect = none()

  switch (request.type) {
  case "next":
  case "moveRight":
    effect = step(next, 1)
    break
  case "previous":
  case "moveLeft":
    effect = step(next, -1)
    break
  case "moveDown":
    effect = moveVertically(next, 1)
    break
  case "moveUp":
    effect = moveVertically(next, -1)
    break
  case "first":
    effect = select(next, 0)
    break
  case "last":
    effect = select(next, next.visible.length - 1)
    break
  case "select":
    effect = select(next, request.index)
    break
  case "type":
    effect = typeText(next, request.text)
    break
  case "deleteBackward":
    effect = deleteBackward(next, selected)
    break
  case "cancel":
    effect = cancel(next)
    break
  case "lockOpen":
    if (!next.isLocked) {
      next.isLocked = true
      effect = refresh()
    }
    break
  case "commit":
    effect = activateOrDismiss(selected)
    break
  case "triggerReleased":
    // Releasing the trigger activates, unless the session was locked open.
    if (!next.isLocked) effect = activateOrDismiss(selected)
    break
  case "quickSelect":
    effect = quickSelect(next, request.index)
    break
  case "peek":
    if (selected && !isWindowless(selected)) effect = {type: "peek", item: selected}
    break
  case "action":
    effect = actionEffect(selected, request.action)
    break
  }
  return {state: next, effect: effect}
}

// Swaps in a fresh item list (a window opened or closed) and reapplies the
// query. The selection follows the same item by id; if it disappeared, it stays
// at the same position, clamped to the new last row, or none when empty.
function replaceItems(state, items) {
  var next = copyState(state)
  var selected = selectedItem(state)
  var selectedId = selected ? selected.id : null
  next.items = items.slice()
  recompute(next, selectedId)
  var stillVisible = next.visible.some(function(row) { return row.item.id === selectedId })
  if (selectedId !== null && !stillVisible) {
    next.selectedIndex = next.visible.length > 0 ? Math.min(state.selectedIndex, next.visible.length - 1) : null
  }
  return next
}

if (typeof module !== "undefined") module.exports = {create: create, handle: handle, replaceItems: replaceItems, selectedItem: selectedItem, isSearching: isSearching}
