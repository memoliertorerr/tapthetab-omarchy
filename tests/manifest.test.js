// Holds manifest.json to the rules Omarchy checks before it loads a plugin
// (bin/omarchy-plugin-validate and shell/services/PluginRegistry.qml), so a
// bad manifest fails here instead of on a user's machine.

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.join(__dirname, "..")
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))

const ENTRY_KEYS = {
  "bar": "bar",
  "bar-widget": "barWidget",
  "menu": "menu",
  "overlay": "overlay",
  "panel": "panel",
  "service": "service"
}

test("manifest has every required field", () => {
  for (const field of ["id", "name", "version", "kinds", "entryPoints"]) {
    assert.ok(manifest[field], `missing ${field}`)
  }
  assert.equal(manifest.schemaVersion, 1)
})

test("manifest id is a valid third-party id", () => {
  assert.match(manifest.id, /^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  assert.ok(!manifest.id.includes(".."), "id contains ..")
  assert.ok(!manifest.id.startsWith("omarchy."), "omarchy. is reserved for first-party plugins")
})

test("plugin id never changes", () => {
  // Users' keybindings and settings are keyed on it.
  assert.equal(manifest.id, "memoliertorerr.tapthetab")
})

test("every kind has an entry point that is a safe relative path to a file", () => {
  assert.ok(Array.isArray(manifest.kinds) && manifest.kinds.length > 0, "kinds must be a non-empty array")
  for (const kind of manifest.kinds) {
    const key = ENTRY_KEYS[kind]
    assert.ok(key, `unknown kind ${kind}`)
    const entry = manifest.entryPoints[key]
    assert.equal(typeof entry, "string", `no entry point for ${kind}`)
    assert.ok(!path.isAbsolute(entry) && !entry.split(/[\\/]/).includes(".."), `unsafe entry point ${entry}`)
    assert.ok(fs.statSync(path.join(root, entry)).isFile(), `entry point ${entry} does not exist`)
  }
})

test("the plugin folder holds no symlinks", () => {
  const symlinks = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) symlinks.push(path.relative(root, full))
      else if (entry.isDirectory()) walk(full)
    }
  }
  walk(root)
  assert.deepEqual(symlinks, [])
})
