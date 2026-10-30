#!/bin/bash

# Installs the plugin the way a user does, summons it over three windows,
# screenshots it, hides it, and lints its QML against the VM's Omarchy shell.

set -euo pipefail
source "$(dirname "$0")/../lib.sh"

log "validate the checkout"
in_session "omarchy plugin validate $TTO_VM_SRC"

log "install with omarchy plugin add"
in_session "omarchy plugin add $TTO_VM_SRC --yes --enable"

plugin_enabled() {
  in_session "omarchy-shell shell listPlugins | jq -e --arg id $TTO_PLUGIN_ID 'any(.[]; .id == \$id and .enabled)'"
}
wait_for 15 "the shell to list $TTO_PLUGIN_ID as enabled" plugin_enabled
log "$TTO_PLUGIN_ID is enabled"

# Lint what the shell loads: the installed clone. qmllint finds `import
# qs.Commons` at <import path>/qs/Commons, and Omarchy's shell directory is
# what Quickshell maps to qs, so a scratch import root links qs to it.
# Syntax errors and worse fail the scenario; warnings are reported only, since
# qmllint cannot see what the shell injects at runtime. The verdict waits for
# the end, so a lint failure still shows whether the overlay works.
read -r -d '' lint <<'LINT' || true
set -euo pipefail
cd "$plugin_dir"
qmllint=$(command -v qmllint || command -v qmllint6 || echo /usr/lib/qt6/bin/qmllint)
[[ -x $qmllint ]] || { echo "qmllint not found"; exit 2; }
lint_root=$(mktemp -d)
ln -s "$OMARCHY_PATH/shell" "$lint_root/qs"
# The first run found no files with find + mapfile and gave no reason, so list
# them with globs and show the directory if the list is still empty.
# With globstar, ** also matches the top level; it skips .git (no dotglob).
shopt -s nullglob globstar
files=(**/*.qml)
if (( ${#files[@]} == 0 )); then
  echo "no QML files found in $PWD"
  ls -la
  exit 2
fi
echo "qmllint $("$qmllint" --version 2>/dev/null | head -n 1) in $PWD on ${files[*]}"
"$qmllint" -I "$OMARCHY_PATH/shell" -I "$lint_root" --json /tmp/tto-qmllint.json "${files[@]}" || true
rm -rf "$lint_root"
jq -r '(.files // [])[] | .filename as $file | (.warnings // [])[] |
  "\($file):\(.line // 0):\(.column // 0): \(.type): \(.message) [\(.id // "")]"' /tmp/tto-qmllint.json
jq -e '[(.files // [])[] | (.warnings // [])[] | select(.type == "critical" or .type == "fatal")] | length == 0' /tmp/tto-qmllint.json >/dev/null
LINT
lint_ok=1
log "qmllint"
if ! in_session "plugin_dir=$TTO_VM_PLUGIN_DIR; $lint" | tee "$TTO_OUT/qmllint.txt"; then
  lint_ok=0
  log "qmllint reported errors; continuing so the summon is still tested"
fi

for title in tto-a tto-b tto-c; do
  open_window "$title"
done

# Enabling reloads the plugin list in the shell; a summon that arrives before
# that answers "unknown" and queues nothing, so it is safe to repeat.
summon_accepted() {
  [[ $(shell_ipc shell summon "$TTO_PLUGIN_ID" '{}') == "ok" ]]
}
wait_for 15 "the shell to accept summon $TTO_PLUGIN_ID" summon_accepted
wait_layer "$TTO_NAMESPACE" mapped 15

# The overlay keeps its first frames transparent until the output's scale
# arrives; give it a moment so the screenshot shows the panel.
sleep 1
screenshot 01-open

shell_ipc shell hide "$TTO_PLUGIN_ID" >/dev/null
wait_layer "$TTO_NAMESPACE" absent

(( lint_ok )) || fail "qmllint reported errors; see qmllint.txt"
log "install and summon passed"
