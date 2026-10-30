// The plugin's settings: defaults, and a lenient decode that never lets a bad
// value crash the plugin or discard the rest. Ports the lenient-decoding and
// validation contract of ../tapthetab/Sources/TapTheTabCore/Configuration.swift;
// port-spec.md section 4 ("Decode and validation contract"). Omarchy owns
// shell.json, so only decode and validate are ported, not the file handling;
// persisting the result is QML's job.
//
// The schema is the Linux-applicable subset of the Swift one. Same-app
// triggers, the hidden/windowless app toggles, grouping, pins and the macOS UI
// settings (Liquid Glass, menu bar icon, themes, positions) are intentionally
// not settings in the MVP.
.pragma library

// The fixed choices for the enum settings; anything else falls back.
var ENUM_VALUES = {
  style: ["list", "grid"],
  size: ["small", "medium", "large"]
}

var SHOW_DELAY_RANGE = [0, 1000]
var LARGE_PREVIEW_PERCENT_RANGE = [25, 150]

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isWholeNumber(value) {
  return typeof value === "number" && isFinite(value) && Math.floor(value) === value
}

function clamp(value, range) {
  return Math.min(range[1], Math.max(range[0], value))
}

// A fresh object every call, so a caller can edit the result freely.
function defaults() {
  return {
    behavior: {
      releaseToSwitch: true,
      searchEnabled: true,
      startOnPrevious: true,
      mouseHoverSelects: true,
      wrapAround: true
    },
    appearance: {
      style: "grid",
      size: "medium",
      showAppName: true,
      showPreviews: false,
      windowThumbnails: true,
      showLargePreview: true,
      largePreviewPercent: 66,
      showDelayMilliseconds: 90
    },
    filters: {
      showMinimized: true,
      currentWorkspaceOnly: false,
      currentMonitorOnly: false,
      excludedAppIds: []
    }
  }
}

// Trims each id, drops non-strings and empties, and removes case-insensitive
// duplicates, keeping the first spelling.
function cleanAppIds(ids) {
  var seen = {}
  var cleaned = []
  ids.forEach(function(id) {
    if (typeof id !== "string") return
    var trimmed = id.replace(/^\s+|\s+$/g, "")
    var key = "$" + trimmed.toLowerCase()
    if (!trimmed || seen[key]) return
    seen[key] = true
    cleaned.push(trimmed)
  })
  return cleaned
}

// One setting: the decoded value when it has the right type, else the default.
// The type of the default says what a valid value looks like.
function decodeSetting(key, fallback, value) {
  if (typeof fallback === "boolean") return typeof value === "boolean" ? value : fallback
  if (typeof fallback === "number") return isWholeNumber(value) ? value : fallback
  if (Array.isArray(fallback)) return Array.isArray(value) ? cleanAppIds(value) : fallback
  if (ENUM_VALUES[key]) return ENUM_VALUES[key].indexOf(value) >= 0 ? value : fallback
  return fallback
}

// Decodes settings from an object or a JSON string. Each missing, null,
// wrong-type or unknown-enum field falls back on its own; a section of the
// wrong type falls back as a whole; unknown keys are ignored. Numbers are
// clamped to their ranges. Throws only when the root is not an object (or the
// string is not JSON); use validate where a throw is not wanted.
function decode(value) {
  if (typeof value === "string") value = JSON.parse(value)
  if (!isObject(value)) throw new TypeError("Settings root must be an object")
  var result = defaults()
  Object.keys(result).forEach(function(section) {
    if (!isObject(value[section])) return
    Object.keys(result[section]).forEach(function(key) {
      result[section][key] = decodeSetting(key, result[section][key], value[section][key])
    })
  })
  var appearance = result.appearance
  appearance.showDelayMilliseconds = clamp(appearance.showDelayMilliseconds, SHOW_DELAY_RANGE)
  appearance.largePreviewPercent = clamp(appearance.largePreviewPercent, LARGE_PREVIEW_PERCENT_RANGE)
  return result
}

// The safe boundary for shell.json: any root that cannot be decoded yields the defaults.
function validate(value) {
  try {
    return decode(value)
  } catch (error) {
    return defaults()
  }
}

if (typeof module !== "undefined") module.exports = {defaults: defaults, decode: decode, validate: validate, cleanAppIds: cleanAppIds}
