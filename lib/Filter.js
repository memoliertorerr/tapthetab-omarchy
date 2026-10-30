// Which items the switcher lists, and the scope reduction (all windows, the
// active app's windows, or one entry per app). Ports
// ../tapthetab/Sources/TapTheTabCore/ItemFilter.swift; port-spec.md section 2
// ("ItemFilter").
//
// Order is never changed: the caller supplies items in recency order and the
// survivors keep it. Workspaces and monitors replace macOS Spaces and displays;
// pinning, grouping and display-first ordering are not ported.
//
// options: {showMinimized, showHiddenApps, showWindowlessApps,
//           currentWorkspaceOnly, currentMonitorOnly, excludedAppIds}
//          (Swift defaults: true, true, false, false, false, [])
// context: {activePID, activeMonitor, ownPID}, each optional
// scope:   "allWindows" | "activeApp" | "apps"
.pragma library

// A windowless app entry has an id of the form "app:<pid>"; the title plays no part.
function isWindowless(item) {
  return item.id.indexOf("app:") === 0
}

function lowerCased(ids) {
  return ids.map(function(id) { return id.toLowerCase() })
}

// Returns the items to list, in their given order.
function apply(items, options, scope, context) {
  options = options || {}
  context = context || {}
  var excluded = lowerCased(options.excludedAppIds || [])

  // allowWindowless lets the active-app fallback bypass only the
  // showWindowlessApps switch; every other rule still applies.
  function passes(item, allowWindowless) {
    if (context.ownPID != null && item.pid === context.ownPID) return false
    // An item without an app id never matches the exclusion list.
    if (item.appId != null && excluded.indexOf(item.appId.toLowerCase()) >= 0) return false
    if (isWindowless(item) && options.showWindowlessApps !== true && !allowWindowless) return false
    if (item.minimized && options.showMinimized === false) return false
    if (item.hidden && options.showHiddenApps === false) return false
    // Minimized, hidden and windowless entries are not on any workspace to
    // speak of, so the workspace rule leaves them alone.
    var offWorkspace = item.onActiveWorkspace === false && !item.minimized && !item.hidden && !isWindowless(item)
    if (options.currentWorkspaceOnly && offWorkspace) return false
    // The monitor rule applies only when both the context and the item know theirs.
    var onOtherMonitor = context.activeMonitor != null && item.monitor != null && item.monitor !== context.activeMonitor
    if (options.currentMonitorOnly && onOtherMonitor) return false
    return true
  }

  var result = items.filter(function(item) { return passes(item, false) })

  if (scope === "activeApp" && context.activePID != null) {
    result = result.filter(function(item) { return item.pid === context.activePID && !isWindowless(item) })
    if (result.length === 0) {
      // The active app has no window left. Offer its windowless entry instead
      // of an empty panel, even when windowless apps are hidden, so it can be
      // activated. It must still pass every other filter; nothing is synthesized.
      result = items.filter(function(item) {
        return item.pid === context.activePID && isWindowless(item) && passes(item, true)
      }).slice(0, 1)
    }
  } else if (scope === "apps") {
    // The first surviving item of each pid represents the app.
    var seenPids = {}
    result = result.filter(function(item) {
      var key = "$" + item.pid
      if (seenPids[key]) return false
      seenPids[key] = true
      return true
    })
  }
  return result
}

if (typeof module !== "undefined") module.exports = {apply: apply, isWindowless: isWindowless}
