// Most-recently-used ordering from focus stamps. Ports
// ../tapthetab/Sources/TapTheTabCore/RecencyTracker.swift; port-spec.md section
// 2 ("RecencyTracker and FocusTracker").
//
// State is a plain object {clock, stamps}. Item ids are strings, either
// "window:<Hyprland address>" or "app:<pid>", so windows and windowless apps
// stay in separate namespaces. Feeding it Hyprland focus and close events is
// the caller's job.
.pragma library

// Stamps are keyed with a "$" prefix so an id like "__proto__" is an ordinary key.
function stampKey(id) {
  return "$" + id
}

function create() {
  return {clock: 0, stamps: {}}
}

// Records that id just received focus. A repeated touch replaces the stamp.
function touch(state, id) {
  state.clock += 1
  state.stamps[stampKey(id)] = state.clock
}

// Forgets one id's stamp. The clock never resets.
function forget(state, id) {
  delete state.stamps[stampKey(id)]
}

// Keeps only the stamps of the ids in keeping, so memory stays bounded.
function prune(state, keeping) {
  Object.keys(state.stamps).forEach(function(key) {
    if (keeping.indexOf(key.slice(1)) < 0) delete state.stamps[key]
  })
}

function stamp(state, id) {
  return state.stamps[stampKey(id)]
}

function trackedCount(state) {
  return Object.keys(state.stamps).length
}

// Stamped items first, newest stamp first; unstamped items keep their supplied
// order after them. A stamp for an item that is absent never adds the item.
function ordered(state, items) {
  var rows = items.map(function(item, offset) {
    return {item: item, offset: offset, stamp: stamp(state, item.id) || 0}
  })
  rows.sort(function(a, b) {
    return b.stamp - a.stamp || a.offset - b.offset
  })
  return rows.map(function(row) { return row.item })
}

if (typeof module !== "undefined") module.exports = {create: create, touch: touch, forget: forget, prune: prune, stamp: stamp, ordered: ordered, trackedCount: trackedCount}
