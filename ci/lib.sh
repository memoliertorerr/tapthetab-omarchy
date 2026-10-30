# Helpers for the end-to-end scenarios. Sourced on the host side (the CI
# container), never inside the VM: every helper reaches the VM over SSH.
#
# Needs TTO_VM_STATE, the run's state directory that ci/run-scenarios creates
# and ci/vm-boot fills: the SSH key, the forwarded port and the QMP socket.
# Scenarios also get TTO_OUT, where screenshots and logs go.
#
# Polling is fine here, in tests. The plugin itself never polls.

TTO_PLUGIN_ID="memoliertorerr.tapthetab"
TTO_NAMESPACE="tapthetab"
# Expanded by the VM's shell, not ours: always pass it inside a remote command.
TTO_VM_SRC='$HOME/src/tapthetab-omarchy'
TTO_VM_PLUGIN_DIR="\$HOME/.config/omarchy/plugins/$TTO_PLUGIN_ID"

: "${TTO_VM_STATE:?TTO_VM_STATE must name the VM state directory}"
TTO_OUT=${TTO_OUT:-out}

log() {
  echo "[$(date +%H:%M:%S)] $*"
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# A command on the VM as the omarchy user, over one shared connection.
# This is a plain SSH login: it does not have the desktop session's
# environment. Use in_session for anything that talks to Hyprland or the shell.
ssh_vm() {
  ssh -i "$TTO_VM_STATE/id_ed25519" -p "$(cat "$TTO_VM_STATE/port")" -o BatchMode=yes -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout="${CONNECT_TIMEOUT:-5}" -o LogLevel=ERROR \
    -o ControlMaster=auto -o ControlPath="$TTO_VM_STATE/ssh.sock" -o ControlPersist=600 omarchy@127.0.0.1 "$@"
}

# Runs a bash snippet in the desktop session, as test/ci-vm does: a transient
# unit of the user manager, which holds the session's environment
# (HYPRLAND_INSTANCE_SIGNATURE, WAYLAND_DISPLAY, OMARCHY_PATH, PATH). Waits for
# it, passes its output through and exits with its status.
in_session() {
  ssh_vm "systemd-run --user --quiet --collect --wait --pipe bash -c $(printf %q "$1")" </dev/null
}

# The same, without waiting: for programs that keep running, like a window.
in_session_bg() {
  ssh_vm "systemd-run --user --quiet --collect bash -c $(printf %q "$1")" </dev/null
}

# wait_for <seconds> <description> <command...>: runs the command until it
# succeeds, every 0.2 s, or fails the scenario after the timeout.
wait_for() {
  local timeout=$1 description=$2
  local started=$SECONDS
  shift 2
  until "$@" >/dev/null 2>&1; do
    if (( SECONDS - started >= timeout )); then
      fail "timed out after ${timeout} s waiting for $description"
    fi
    sleep 0.2
  done
}

# Prints mapped or absent for a layer namespace, like Omarchy's
# scratch_layer_state: mapped means a surface with a size.
layer_state() {
  in_session "hyprctl -j layers | jq -e --arg ns $(printf %q "$1") '
    [.. | objects | select(.namespace? == \$ns and .w > 0 and .h > 0)] | length > 0
  ' >/dev/null && echo mapped || echo absent"
}

layer_is() {
  [[ $(layer_state "$1") == "$2" ]]
}

# wait_layer <namespace> mapped|absent [timeout]
wait_layer() {
  local namespace=$1 want=$2 timeout=${3:-10}
  [[ $want == "mapped" || $want == "absent" ]] || fail "wait_layer: want mapped or absent, not $want"
  if ! (wait_for "$timeout" "layer $namespace to be $want" layer_is "$namespace" "$want"); then
    in_session 'hyprctl layers' >&2 || true
    fail "layer $namespace is not $want after ${timeout} s"
  fi
  log "layer $namespace is $want"
}

# screenshot <name>: the whole screen, grabbed with grim in the session, saved
# as $TTO_OUT/screenshots/<name>.png.
screenshot() {
  local name=$1
  mkdir -p "$TTO_OUT/screenshots"
  in_session "grim /tmp/tto-shot.png"
  ssh_vm 'cat /tmp/tto-shot.png && rm -f /tmp/tto-shot.png' >"$TTO_OUT/screenshots/$name.png"
  log "screenshot $TTO_OUT/screenshots/$name.png"
}

window_exists() {
  in_session "hyprctl -j clients | jq -e --arg t $(printf %q "$1") 'any(.[]; .title == \$t)'"
}

# open_window <title>: a terminal with that title, started the way Omarchy
# starts one (uwsm-app and xdg-terminal-exec), running nothing but sleep so no
# prompt renames it. Waits until Hyprland lists it.
open_window() {
  local title=$1
  in_session_bg "exec uwsm-app -- xdg-terminal-exec --app-id=tto.test --title=$(printf %q "$title") -e sleep infinity"
  if ! (wait_for 20 "window $title" window_exists "$title"); then
    in_session 'hyprctl clients' >&2 || true
    fail "window $title did not appear"
  fi
  log "window $title is open"
}

active_title() {
  in_session "hyprctl -j activewindow | jq -r '.title // empty'"
}

# omarchy-shell <target> <method> [args...] in the session.
shell_ipc() {
  local command="omarchy-shell" arg
  for arg in "$@"; do
    command+=" $(printf %q "$arg")"
  done
  in_session "$command"
}

# Sends QMP commands (one JSON object per argument) to QEMU, after the
# capabilities handshake QMP requires on every connection.
qmp() {
  local socket="$TTO_VM_STATE/qmp.sock"
  [[ -S $socket ]] || fail "no QMP socket at $socket"
  printf '%s\n' '{"execute":"qmp_capabilities"}' "$@" | socat -t 1 - "UNIX-CONNECT:$socket"
}

qmp_key_event() {
  local down=$1 qcode=$2
  printf '{"execute":"input-send-event","arguments":{"events":[{"type":"key","data":{"down":%s,"key":{"type":"qcode","data":"%s"}}}]}}' "$down" "$qcode"
}

# Sends key events and fails on any error QEMU answers with.
qmp_keys() {
  local reply
  reply=$(qmp "$@")
  if [[ $reply == *'"error"'* ]]; then
    echo "$reply" >&2
    fail "QMP refused a key event"
  fi
}

# qmp_key down|up <qcode>: press or release a real key, as the keyboard would.
# qcodes are QEMU's names: alt, shift, tab, esc, ret, a, b, ...
qmp_key() {
  local direction=$1 qcode=$2
  case $direction in
  down) qmp_keys "$(qmp_key_event true "$qcode")" ;;
  up) qmp_keys "$(qmp_key_event false "$qcode")" ;;
  *) fail "qmp_key: want down or up, not $direction" ;;
  esac
}

# qmp_tap <qcode>: press and release.
qmp_tap() {
  qmp_keys "$(qmp_key_event true "$1")" "$(qmp_key_event false "$1")"
}

trap 'echo "FAIL: line $LINENO: $BASH_COMMAND" >&2' ERR
