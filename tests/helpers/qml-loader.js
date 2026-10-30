// Loads lib/*.js the two ways they run.
//
// QML understands the `.pragma library` and `.import` lines at the top of a lib
// file; Node does not. Like Omarchy's own test loader, this strips only those
// directives:
//
//   node("Fuzzy.js")  requires the file through Node, so its
//                     `typeof require === "function" ? require(...)` path runs.
//   qml("Fuzzy.js")   evaluates the file in a bare context the way QML does:
//                     no `require`, each `.import "X.js" as Alias` becomes a
//                     global `Alias` holding the imported module's scope.
//
// A test that touches a module with `.import` lines should use both, so the
// two dependency paths stay covered.

const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")
const vm = require("node:vm")

const LIB_DIR = path.resolve(__dirname, "../../lib")
const IMPORT_LINE = /^\.import "([^"]+)" as (\w+)\r?$/mg
const PRAGMA_LINE = /^\.pragma library\r?$/mg

function stripDirectives(source) {
  return source.replace(IMPORT_LINE, "").replace(PRAGMA_LINE, "")
}

const originalLoader = Module._extensions[".js"]
Module._extensions[".js"] = function (module, filename) {
  if (!filename.startsWith(LIB_DIR + path.sep)) return originalLoader(module, filename)
  module._compile(stripDirectives(fs.readFileSync(filename, "utf8")), filename)
}

function node(name) {
  return require(path.join(LIB_DIR, name))
}

const scopes = {}

// `prelude` is JavaScript run in the fresh context before the module, for
// tests that need an engine without a builtin; such a scope is not cached.
function qml(name, prelude) {
  if (!prelude && scopes[name]) return scopes[name]
  const scope = {}
  const source = fs.readFileSync(path.join(LIB_DIR, name), "utf8")
    .replace(IMPORT_LINE, (_, file, alias) => {
      scope[alias] = qml(file)
      return ""
    })
    .replace(PRAGMA_LINE, "")
  vm.createContext(scope)
  if (prelude) vm.runInContext(prelude, scope)
  vm.runInContext(source, scope, { filename: name })
  if (!prelude) scopes[name] = scope
  return scope
}

module.exports = { node, qml, LIB_DIR }
