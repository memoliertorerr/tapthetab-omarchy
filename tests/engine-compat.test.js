// Holds lib/*.js to the subset Quickshell's QML engine (QV4) is known to run
// (port-spec.md section 0), and to the shape QML needs: `.pragma library`
// first, then the `.import` lines, then code, ending with the Node export.
// Whether QV4 really loads the modules is checked in the VM job, not here.

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { node, qml, LIB_DIR } = require("./helpers/qml-loader.js")

function withoutComments(source) {
  return source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")
}

// A cheap lexical guard, not a QV4 parser: true if the source uses syntax or
// APIs beyond ES5 as QV4 has it. Regex flags and escapes are checked before
// string literals are blanked, because a regex may contain a quote.
function usesUnsupportedFeatures(source) {
  const code = withoutComments(source)
  const hasUnicodeRegex = /\\[pP]\{|\/(?:[^/\n\\]|\\.)+\/[dgimsuvy]*[uv]/.test(code)
  if (hasUnicodeRegex) return true
  const withoutStrings = code.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "")
  const unsupported = [
    /\b(?:let|const|class|Intl)\b/,
    /=>/,
    /`/,
    /\.\.\./,
    /\bfor\s*\([^)]*\bof\b/,
    /\bvar\s*[[{]/,
    /\bfunction\s*\w*\s*\(\s*[[{]/
  ]
  return unsupported.some((pattern) => pattern.test(withoutStrings))
}

const UNSUPPORTED_SAMPLES = [
  ["let", "let x = 1"],
  ["const", "const x = 1"],
  ["class", "class A {}"],
  ["arrow function", "x => x"],
  ["template literal", "`x`"],
  ["spread", "f(...a)"],
  ["object destructuring", "var {x} = a"],
  ["array destructuring", "var [x] = a"],
  ["parameter destructuring", "function f({x}) {}"],
  ["for..of", "for (var x of a) {}"],
  ["Intl", "Intl.Segmenter"],
  ["regex u flag", "/x/u"],
  ["regex property escape", "/\\p{L}/"]
]

const SUPPORTED_SAMPLES = [
  "var x = 1",
  "var text = \"let const => `x` ...\"",
  "// let const class",
  "/* Intl and the u flag */ var ok = /x/g",
  "for (var key in object) {}",
  "var pair = /\\u00e9/"
]

test("the syntax guard flags what QV4 may not run and passes what it does", () => {
  for (const [name, source] of UNSUPPORTED_SAMPLES) assert.equal(usesUnsupportedFeatures(source), true, name)
  for (const source of SUPPORTED_SAMPLES) assert.equal(usesUnsupportedFeatures(source), false, source)
})

const libFiles = fs.readdirSync(LIB_DIR).filter((name) => name.endsWith(".js"))

// The first line of code, ignoring blank lines and the header comment.
function codeLines(source) {
  return source.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("//"))
}

test("there are lib files to check", () => {
  assert.ok(libFiles.length >= 8, libFiles.join(", "))
})

test("every lib file stays within the engine subset", () => {
  for (const name of libFiles) {
    const source = fs.readFileSync(path.join(LIB_DIR, name), "utf8")
    assert.equal(usesUnsupportedFeatures(source), false, name)
  }
})

test("every lib file starts with .pragma library, then its .import lines, then code", () => {
  for (const name of libFiles) {
    const lines = codeLines(fs.readFileSync(path.join(LIB_DIR, name), "utf8"))
    assert.equal(lines[0], ".pragma library", `${name}: first directive`)
    const firstCode = lines.findIndex((line) => !line.startsWith("."))
    assert.ok(firstCode > 0, `${name}: has code`)
    assert.ok(lines.slice(1, firstCode).every((line) => /^\.import "[^"]+\.js" as \w+$/.test(line)), `${name}: imports before code`)
    assert.ok(lines.slice(firstCode).every((line) => !line.startsWith(".")), `${name}: no directive after code`)
  }
})

test("every lib file ends with the Node export that QML never evaluates", () => {
  for (const name of libFiles) {
    const lines = codeLines(fs.readFileSync(path.join(LIB_DIR, name), "utf8"))
    assert.match(lines[lines.length - 1], /^if \(typeof module !== "undefined"\) module\.exports = \{.+\}$/, name)
  }
})

test("every lib file loads both through Node and the way QML does, exporting the same names", () => {
  for (const name of libFiles) {
    const exported = node(name)
    const scope = qml(name)
    for (const key of Object.keys(exported)) {
      assert.equal(typeof scope[key], typeof exported[key], `${name}: ${key}`)
    }
  }
})

module.exports = { usesUnsupportedFeatures }
