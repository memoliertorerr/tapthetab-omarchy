// Turns a key press into a switcher input. Ports
// ../tapthetab/Sources/TapTheTabCore/KeyRouter.swift; port-spec.md section 2
// ("KeyRouter: precedence matters") is the contract.
//
// press:   {key, text, modifiers}. key is a logical name ("Tab", "Left",
//          "Return", "Space", "Backspace", ...), never a Carbon or Qt numeric
//          code. text is the layout-aware text of the key, ignoring every
//          modifier except Shift. modifiers are lowercase names: "alt",
//          "control", "super", "shift", "fn".
// options: {triggerKey (default "Tab"), triggerModifiers, searchEnabled
//          (default true), actionsEnabled, peekEnabled}
// returns: a session input ({type, text?, action?}) or null when the key means nothing.
//
// Window actions (Shift+W and friends), peek and quick-select digits are
// "Later" in the plan: actions and peek are opt-in, quick-select is not ported.
//
// fromQt(key, text, modifiers) builds a press from a QML KeyEvent's key,
// text and modifiers, so the overlay hands Qt's numbers over untouched.
.pragma library
.import "Graphemes.js" as Graphemes

var G = typeof require === "function" ? require("./Graphemes.js") : Graphemes

var DEFAULT_TRIGGER_KEY = "Tab"

// Keys that always mean the same thing (spec precedence 2 and 3).
var NAVIGATION_INPUTS = {
  Left: "moveLeft",
  Right: "moveRight",
  Up: "moveUp",
  Down: "moveDown",
  Home: "first",
  PageUp: "first",
  End: "last",
  PageDown: "last",
  Return: "commit",
  Enter: "commit",
  KeypadEnter: "commit",
  Escape: "cancel"
}

// Shift plus one of these letters acts on the selection (spec precedence 8).
var ACTION_KEYS = {
  w: "close",
  m: "minimize",
  f: "toggleFullscreen",
  h: "hideApp",
  q: "quitApp",
  d: "moveToNextDisplay",
  x: "closeAppWindows",
  p: "togglePin"
}

// Qt's key codes (Qt::Key) for the keys route names. Stable across Qt 6.
var QT_KEY_NAMES = {
  "16777216": "Escape",
  "16777217": "Tab",
  "16777219": "Backspace",
  "16777220": "Return",
  "16777221": "Enter",
  "16777223": "Delete",
  "16777232": "Home",
  "16777233": "End",
  "16777234": "Left",
  "16777235": "Up",
  "16777236": "Right",
  "16777237": "Down",
  "16777238": "PageUp",
  "16777239": "PageDown",
  "32": "Space"
}

// Qt::Key_Backtab: what Qt reports for Shift+Tab.
var QT_KEY_BACKTAB = 16777218

// Qt's keyboard modifier flags (Qt::KeyboardModifier) and their names here.
// Qt calls the Super key Meta.
var QT_MODIFIERS = [
  [0x02000000, "shift"],
  [0x04000000, "control"],
  [0x08000000, "alt"],
  [0x10000000, "super"]
]

// Invisible and formatting characters never go into the search field.
var INVISIBLE_FORMAT = /^[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]$/

function has(table, key) {
  return Object.prototype.hasOwnProperty.call(table, key)
}

function hasModifier(modifiers, name) {
  return modifiers.indexOf(name) >= 0
}

// A single grapheme worth typing: letters, numbers, punctuation, symbols and a
// plain space. Control codes, private use, other whitespace and invisible
// format characters are not.
function isPrintable(text) {
  var code = text.charCodeAt(0)
  if (code < 32) return false
  if (code >= 127 && code <= 159) return false
  if (code >= 0xe000 && code <= 0xf8ff) return false
  if (G.whitespace(text) && text !== " ") return false
  return !INVISIBLE_FORMAT.test(text)
}

// Routes one key-down in the precedence order of the spec: trigger key,
// navigation, delete, Tab, Space, then text.
function route(press, options, isSearching) {
  options = options || {}
  var key = press.key
  var modifiers = press.modifiers || []
  var triggerModifiers = options.triggerModifiers || []
  var text = press.text
  var shift = hasModifier(modifiers, "shift")

  // 1. The trigger key wins even when it is a letter, Space, an arrow or a digit.
  if (key === (options.triggerKey || DEFAULT_TRIGGER_KEY)) return {type: shift ? "previous" : "next"}

  // 2-3. Arrows, Home/End, Return and Escape.
  if (has(NAVIGATION_INPUTS, key)) return {type: NAVIGATION_INPUTS[key]}

  // 4. Backspace and forward Delete both delete backward, when search is on.
  if (key === "Backspace" || key === "Delete") {
    if (options.searchEnabled === false) return null
    return {type: "deleteBackward"}
  }

  // 5. Tab always cycles, even when the trigger is another key.
  if (key === "Tab") return {type: shift ? "previous" : "next"}

  // 6. Shift+Space peeks; plain Space with an empty search locks the switcher open.
  if (key === "Space" && shift) return options.peekEnabled ? {type: "peek"} : null
  if (key === "Space" && !isSearching) return {type: "lockOpen"}

  // 8. Everything else must be exactly one grapheme of text.
  if (typeof text !== "string" || G.split(text).length !== 1) return null

  // Extra Control or Super (beyond the trigger's own) makes a chord, not text.
  // Extra Alt does not: the trigger is usually Alt, and typing must work while it is held.
  var extraControl = hasModifier(modifiers, "control") && !hasModifier(triggerModifiers, "control")
  var extraSuper = hasModifier(modifiers, "super") && !hasModifier(triggerModifiers, "super")
  if (extraControl || extraSuper) return null

  var lowerText = text.toLowerCase()
  if (shift && options.actionsEnabled && has(ACTION_KEYS, lowerText)) {
    return {type: "action", action: ACTION_KEYS[lowerText]}
  }

  if (options.searchEnabled === false) return null
  if (!isPrintable(text)) return null
  return {type: "type", text: text}
}

// A press from a Qt key event. A key route has no name for gets an empty key
// and is judged by its text alone.
function fromQt(key, text, modifiers) {
  var flags = modifiers || 0
  var names = QT_MODIFIERS.filter(function(pair) { return (flags & pair[0]) !== 0 }).map(function(pair) { return pair[1] })
  if (key === QT_KEY_BACKTAB) {
    if (names.indexOf("shift") < 0) names.push("shift")
    return {key: "Tab", text: "\t", modifiers: names}
  }
  var name = has(QT_KEY_NAMES, String(key)) ? QT_KEY_NAMES[String(key)] : ""
  return {key: name, text: typeof text === "string" ? text : "", modifiers: names}
}

if (typeof module !== "undefined") module.exports = {route: route, fromQt: fromQt}
