#!/bin/bash

# The first usable build, end to end: the switcher lists windows most recently
# used first, real keys filter it, Enter switches, and the order follows
# focus. What the switcher shows is read from its read-only `tapthetab state`
# IPC call; screenshots show the same for a human.

set -euo pipefail
source "$(dirname "$0")/../lib.sh"

expect_rows() {
  local want=$1 got
  got=$(switcher '[.rows[].title] | join(",")')
  [[ $got == "$want" ]] || fail "expected the rows $want, got ${got:-none}"
  log "rows: $got"
}

switcher_open() {
  [[ $(switcher '.opened') == "true" ]]
}

query_is() {
  [[ $(switcher '.query') == "$1" ]]
}

summon() {
  shell_ipc shell summon "$TTO_PLUGIN_ID" '{}' >/dev/null
  wait_layer "$TTO_NAMESPACE" mapped 15
  wait_for 5 "the switcher to report itself open" switcher_open
}

# 01 left windows with these titles open. Fresh ones, each focused as it
# opens, make the order below come from this scenario's focus events, and
# closing the old ones exercises the tracker's closewindow path.
for title in tto-a tto-b tto-c; do
  close_window "$title"
done
for title in tto-a tto-b tto-c; do
  open_window "$title"
  wait_for 10 "$title to be focused as it opens" active_is "$title"
done

log "summon: most recently used first"
summon
expect_rows "tto-c,tto-b,tto-a"
# The overlay can be transparent for its first frames.
sleep 1
screenshot 02-list

log "type tto-a with real keys"
for qcode in t t o minus a; do
  qmp_tap "$qcode"
done
if ! (wait_for 5 "the search to read tto-a" query_is tto-a); then
  switcher '.' >&2 || true
  fail "the typed keys did not reach the search"
fi
expect_rows "tto-a"
screenshot 02-filtered

log "Enter switches to tto-a and closes the switcher"
qmp_tap ret
wait_layer "$TTO_NAMESPACE" absent
if ! (wait_for 10 "tto-a to be active" active_is tto-a); then
  in_session 'hyprctl activewindow; hyprctl clients' >&2 || true
  fail "Enter did not switch to tto-a (active: $(active_title))"
fi
log "tto-a is active"

log "focus tto-b from outside the switcher, then summon again"
focus_window tto-b
summon
expect_rows "tto-b,tto-a,tto-c"
shell_ipc shell hide "$TTO_PLUGIN_ID" >/dev/null
wait_layer "$TTO_NAMESPACE" absent

log "MRU, search and switching passed"
