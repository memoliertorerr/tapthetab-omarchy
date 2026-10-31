// Hyprland's windows as switcher items, the most-recently-used bookkeeping
// that orders them, and the dispatches that bring one forward. Switcher.qml
// owns everything Quickshell: it feeds Hyprland raw events to trackEvent, and
// on open() hands a plain snapshot of the toplevels to items.
//
// snapshot: one plain object per Hyprland toplevel, built in Switcher.qml:
//           {address, appId, title, parented, workspace, monitor,
//            focusHistoryID, pid, appName}
//           address         as Quickshell or Hyprland gives it, 0x or not
//           appId           the Wayland app id; "" while the window has none
//           title           the window title
//           parented        true for a child window such as a dialog
//           workspace       {id, name}, or null when unknown
//           monitor         the monitor's name, optional
//           focusHistoryID  Hyprland's focus order at the last
//                           Hyprland.refreshToplevels() (0 = focused), or null
//           pid             optional
//           appName         optional display name; derived from appId if absent
// item:     the Session.js item shape, plus the address to dispatch on:
//           {id: "window:<address>", address, pid, title, appName, appId,
//            workspace (its name), workspaceId, monitor, minimized,
//            onActiveWorkspace, focusStamp}
//
// Addresses are compared normalised: lower-case hex without the 0x that
// hyprctl prints and that raw events leave out. Dispatches get the 0x back,
// as Omarchy's own scripts pass it.
//
// trackEvent and seed change the Recency state they are given in place: the
// tracker in Switcher.qml keeps one state for the life of the plugin.
.pragma library
.import "Recency.js" as Recency

var R = typeof require === "function" ? require("./Recency.js") : Recency

var HEX = /^[0-9a-f]+$/

// Raw events after which the list may show something different: a window
// opened, closed, moved or renamed.
var LIST_EVENTS = ["openwindow", "closewindow", "movewindowv2", "windowtitlev2"]

// "0x55AB…", "55ab…" and " 0x55ab " are the same window. Anything that is not
// hex is no address at all, so it can never reach a dispatch string.
function normalizeAddress(address) {
  var text = String(address == null ? "" : address).trim().toLowerCase()
  if (text.indexOf("0x") === 0) text = text.slice(2)
  return HEX.test(text) ? text : ""
}

function windowId(address) {
  var normalized = normalizeAddress(address)
  return normalized ? "window:" + normalized : ""
}

// Workspace names a dispatch may carry. Anything else (quotes, backslashes,
// control characters) is not worth escaping into a Lua string.
var SAFE_WORKSPACE_NAME = /^[A-Za-z0-9 _.+-]+$/

// Minimized windows live on special workspaces ("special:minimized",
// "special:scratchpad", plain "special"). Negative ids alone don't tell:
// Hyprland gives ordinary named workspaces negative ids too (from -1337 down),
// so the name decides, and the id only when there is no name (specials use
// -99 to -2).
function isSpecialWorkspace(workspace) {
  if (!workspace) return false
  var name = String(workspace.name || "")
  if (name) return /^special(:|$)/.test(name)
  return typeof workspace.id === "number" && workspace.id >= -99 && workspace.id <= -2
}

// The selector that names a workspace in a dispatch: its number for a numbered
// workspace, "name:<name>" for a named one, "" when it can't be named safely
// (unknown, special, or an odd name).
function workspaceSelector(workspace) {
  if (!workspace || isSpecialWorkspace(workspace)) return ""
  var id = workspace.id
  if (typeof id === "number" && id >= 1 && Math.floor(id) === id) return String(id)
  var name = String(workspace.name || "")
  return name && SAFE_WORKSPACE_NAME.test(name) ? "name:" + name : ""
}

// "org.gnome.Nautilus" reads as "Nautilus"; a short id like "foot" or
// "tto.test" stays as it is.
function appNameFor(appId) {
  var parts = appId.split(".")
  return parts.length >= 3 && parts[parts.length - 1] ? parts[parts.length - 1] : appId
}

// Windows without an app id, and child windows such as dialogs, are left out,
// as Omarchy's dock leaves them out.
function listable(snapshot) {
  return !!windowId(snapshot.address) && !!snapshot.appId && !snapshot.parented
}

// context: {activeWorkspaceId}, optional. Without it onActiveWorkspace is left
// unset, so no workspace filter can drop the item.
function toItem(snapshot, recency, context) {
  var id = windowId(snapshot.address)
  var appId = String(snapshot.appId)
  var workspace = snapshot.workspace || null
  var item = {
    id: id,
    address: normalizeAddress(snapshot.address),
    pid: typeof snapshot.pid === "number" ? snapshot.pid : null,
    title: String(snapshot.title || ""),
    appName: snapshot.appName ? String(snapshot.appName) : appNameFor(appId),
    appId: appId,
    workspace: workspace ? String(workspace.name || workspace.id) : null,
    workspaceId: workspace ? workspace.id : null,
    monitor: snapshot.monitor ? String(snapshot.monitor) : null,
    minimized: isSpecialWorkspace(workspace),
    focusStamp: R.stamp(recency, id) || 0
  }
  if (context && typeof context.activeWorkspaceId === "number") {
    item.onActiveWorkspace = !!workspace && workspace.id === context.activeWorkspaceId
  }
  return item
}

// The listable windows of a snapshot as items, most recently focused first.
// Windows never focused since the plugin loaded (opened in the background,
// say) follow in Hyprland's order.
function items(snapshots, recency, context) {
  var seen = {}
  var list = []
  snapshots.forEach(function(snapshot) {
    if (!listable(snapshot)) return
    var item = toItem(snapshot, recency, context)
    if (seen["$" + item.id]) return
    seen["$" + item.id] = true
    list.push(item)
  })
  return R.ordered(recency, list)
}

// Feeds one Hyprland raw event, name and data as Quickshell's rawEvent gives
// them, to the MRU state: a focused window moves to the front, a closed one is
// forgotten. An empty activewindowv2 (focus went to a layer or nowhere) is
// ignored. Returns true when the state changed.
function trackEvent(recency, name, data) {
  var id = windowId(String(data == null ? "" : data).split(",")[0])
  if (!id) return false
  if (name === "activewindowv2") {
    R.touch(recency, id)
    return true
  }
  if (name === "closewindow") {
    R.forget(recency, id)
    return true
  }
  return false
}

// Whether a raw event can add, remove or move a window, so an open switcher
// should rebuild its list.
function changesList(name) {
  return LIST_EVENTS.indexOf(name) >= 0
}

// Drops the stamps of windows that are gone, in case a closewindow was missed.
function forgetMissing(recency, snapshots) {
  R.prune(recency, snapshots.map(function(snapshot) { return windowId(snapshot.address) }))
}

// Seeds the MRU state from Hyprland's focus history, once, so windows focused
// before the plugin loaded are in order too. Windows focused since then keep
// their order ahead of the seeded ones. The history is what the last
// Hyprland.refreshToplevels() reported; it goes stale, which is why focus
// events, not the history, order everything after this. Returns false, and
// changes nothing, when no snapshot carries a history yet.
function seed(recency, snapshots) {
  var known = snapshots.filter(function(snapshot) {
    return !!windowId(snapshot.address) && typeof snapshot.focusHistoryID === "number" && snapshot.focusHistoryID >= 0
  })
  if (known.length === 0) return false

  var ids = snapshots.map(function(snapshot) { return windowId(snapshot.address) })
  var touched = ids.filter(function(id, index) {
    return !!id && ids.indexOf(id) === index && !!R.stamp(recency, id)
  })
  touched.sort(function(a, b) { return R.stamp(recency, a) - R.stamp(recency, b) })
  var untouched = known.filter(function(snapshot) { return !R.stamp(recency, windowId(snapshot.address)) })
  // The highest history id was focused longest ago, so it is stamped first.
  untouched.sort(function(a, b) { return b.focusHistoryID - a.focusHistoryID })

  var fresh = R.create()
  untouched.forEach(function(snapshot) { R.touch(fresh, windowId(snapshot.address)) })
  touched.forEach(function(id) { R.touch(fresh, id) })
  recency.clock = fresh.clock
  recency.stamps = fresh.stamps
  return true
}

// The Hyprland dispatches that bring an item's window forward, in order, in
// the syntax stable Omarchy's scripts use (bin/omarchy-hyprland-focus-app,
// bin/omarchy-hyprland-window-pop): a minimized window first moves to the
// active workspace, as Omarchy's dock brings it forward, then it is focused
// and raised. activeWorkspace is {id, name}, or null when unknown; a
// minimized window stays where it is when the active workspace can't be named.
// No valid address, no dispatch.
function focusSteps(item, activeWorkspace) {
  var address = normalizeAddress(item && item.address)
  if (!address) return []
  var target = "window = \"address:0x" + address + "\""
  var steps = []
  var destination = workspaceSelector(activeWorkspace)
  if (item.minimized && destination) {
    steps.push("hl.dsp.window.move({ " + target + ", workspace = \"" + destination + "\" })")
  }
  steps.push("hl.dsp.focus({ " + target + " })")
  steps.push("hl.dsp.window.alter_zorder({ " + target + ", mode = \"top\" })")
  return steps
}

if (typeof module !== "undefined") module.exports = {normalizeAddress: normalizeAddress, windowId: windowId, isSpecialWorkspace: isSpecialWorkspace, workspaceSelector: workspaceSelector, items: items, trackEvent: trackEvent, changesList: changesList, forgetMissing: forgetMissing, seed: seed, focusSteps: focusSteps}
