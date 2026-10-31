#!/bin/bash

# The plugin starts no process while idle, not even when Hyprland events
# arrive. The idea comes from Omarchy's test/shell.d/shell-idle-spawn-test.sh
# (development branch; stable 4.0.6 has no such test): run a second shell,
# let its startup finish, watch it for 30 s, fail naming what it started.
#
# Stable Omarchy's own shell polls while idle (battery, keyboard layout,
# tailscale, ...), so watching the session's shell would blame us for its
# processes. The second shell here loads nothing but the installed plugin, in
# a systemd unit of its own, so everything it starts is the plugin's:
#
# - new processes in the unit's cgroup, sampled every 50 ms, give the names
#   (a detached process stays in the cgroup after its parent lets go of it);
# - the shell's cminflt/cmajflt in /proc/<pid>/stat grow whenever it reaps a
#   child, however short-lived, so a spawn the sampling misses still fails.
#
# Halfway through, focus moves between the test windows and a window opens
# and closes, so the MRU tracker's event handling is watched too.

set -euo pipefail
source "$(dirname "$0")/../lib.sh"

read -r -d '' idle <<'IDLE' || true
set -euo pipefail
window=30
unit=tto-idle-shell
switcher_qml="$plugin_dir/Switcher.qml"
[[ -f $switcher_qml ]] || { echo "the plugin is not installed: no $switcher_qml"; exit 2; }
qs_bin=$(command -v qs || command -v quickshell) || { echo "neither qs nor quickshell is installed"; exit 2; }

root=$(mktemp -d /tmp/tto-idle.XXXXXX)
cleanup() {
  systemctl --user stop "$unit" 2>/dev/null || true
  rm -rf "$root"
}
trap cleanup EXIT

# A copy of Omarchy's shell directory, so qs.Commons and qs.Ui resolve as they
# do for the real shell, with a shell.qml that loads only the plugin. Its own
# config path gives it its own IPC socket: it never answers for the session's.
cp -a "$OMARCHY_PATH/shell" "$root/shell"
cat >"$root/shell/shell.qml" <<'QML'
//@ pragma OmarchyLoadPatch
import Quickshell
import QtQuick

ShellRoot {
  Loader {
    source: "file://" + Quickshell.env("TTO_SWITCHER")
  }
}
QML

systemd-run --user --quiet --collect --unit="$unit" --expand-environment=no \
  --setenv=TTO_SWITCHER="$switcher_qml" --setenv=QS_NO_RELOAD_POPUP=1 --setenv=QS_DISABLE_FILE_WATCHER=1 \
  -- "$qs_bin" -p "$root/shell" --no-color

shell_log() {
  journalctl --user -u "$unit" --no-pager -n 80 || true
}

ready=0
for _ in $(seq 150); do
  if timeout 2 "$qs_bin" ipc -n -p "$root/shell" call tapthetab state 2>/dev/null | jq -e '.opened == false' >/dev/null 2>&1; then
    ready=1
    break
  fi
  systemctl --user is-active --quiet "$unit" || break
  sleep 0.2
done
if (( !ready )); then
  echo "the idle test shell did not load the plugin within 30 s"
  shell_log
  exit 1
fi

pid=$(systemctl --user show -p MainPID --value "$unit")
cgroup=/sys/fs/cgroup$(systemctl --user show -p ControlGroup --value "$unit")
if [[ ! $pid =~ ^[1-9][0-9]*$ || ! -f $cgroup/cgroup.procs ]]; then
  echo "cannot find the idle test shell (pid '$pid', cgroup $cgroup)"
  exit 1
fi
echo "idle test shell: pid $pid, cgroup $cgroup"

# Children the shell has reaped, as their page faults: fields 11 and 13 of
# /proc/<pid>/stat, counted after the parenthesised command name.
reaped() {
  local stat fields
  stat=$(<"/proc/$pid/stat")
  read -ra fields <<<"${stat##*) }"
  echo "${fields[8]}/${fields[10]}"
}

procs() {
  local list
  list=$(<"$cgroup/cgroup.procs")
  echo $list
}

# Startup runs its one-off probes (Omarchy's Style asks hyprctl and fc-match).
# Idle starts once nothing has changed for 4 s; a shell that never settles is
# watched anyway and fails below.
started=$SECONDS
quiet_since=$SECONDS
last="$(reaped) $(procs)"
while (( SECONDS - started < 30 )); do
  sleep 0.5
  now="$(reaped) $(procs)"
  if [[ $now != "$last" ]]; then
    last=$now
    quiet_since=$SECONDS
  elif (( SECONDS - quiet_since >= 4 )); then
    break
  fi
done
echo "settled after $(( SECONDS - started )) s: $(procs)"

# Hyprland events for the tracker: focus each test window, open and close one.
# Fails when it can't produce them, so the check never passes untested.
idle_window() {
  hyprctl -j clients | jq -r 'first(.[] | select(.title == "tto-idle") | .address) // empty'
}
drive_events() {
  local address focused=0 tries
  for address in $(hyprctl -j clients | jq -r '.[] | select(.title | startswith("tto-")) | .address'); do
    hyprctl dispatch "hl.dsp.focus({ window = \"address:$address\" })" >/dev/null
    focused=$(( focused + 1 ))
    sleep 1
  done
  if (( focused == 0 )); then
    echo "drive_events: no tto- window to focus"
    return 1
  fi
  uwsm-app -- xdg-terminal-exec --app-id=tto.test --title=tto-idle -e sleep infinity >/dev/null 2>&1 &
  address=""
  for (( tries = 0; tries < 40; tries++ )); do
    address=$(idle_window)
    [[ -n $address ]] && break
    sleep 0.25
  done
  if [[ -z $address ]]; then
    echo "drive_events: the tto-idle window did not appear"
    return 1
  fi
  hyprctl dispatch "hl.dsp.window.close({ window = \"address:$address\" })" >/dev/null
  for (( tries = 0; tries < 40; tries++ )); do
    [[ -z $(idle_window) ]] && return 0
    sleep 0.25
  done
  echo "drive_events: the tto-idle window did not close"
  return 1
}

declare -A seen=()
for p in $(procs); do
  seen[$p]=1
done
spawned=()
before=$(reaped)
end=$(( SECONDS + window ))
events_at=$(( SECONDS + 5 ))
driver=""
while (( SECONDS < end )); do
  for p in $(procs); do
    [[ -n ${seen[$p]:-} ]] && continue
    seen[$p]=1
    spawned+=("$p: $(tr '\0' ' ' <"/proc/$p/cmdline" 2>/dev/null || echo '(gone before it could be named)')")
  done
  if (( events_at > 0 && SECONDS >= events_at )); then
    events_at=0
    drive_events &
    driver=$!
  fi
  sleep 0.05
done
if [[ -z $driver ]]; then
  echo "the event driver never started"
  exit 1
fi
if ! wait "$driver"; then
  echo "the event driver failed, so event handling was not watched"
  shell_log
  exit 1
fi
after=$(reaped)

echo "watched ${window} s; reaped-children counters $before -> $after"
if (( ${#spawned[@]} > 0 )) || [[ $before != "$after" ]]; then
  echo "a shell running only TapTheTab started processes while idle:"
  printf '  %s\n' "${spawned[@]}"
  [[ $before == "$after" ]] || echo "  it also reaped children it started (cminflt/cmajflt $before -> $after)"
  shell_log
  exit 1
fi
echo "no process started in ${window} s"
IDLE

log "watch a shell running only the plugin for 30 s"
in_session "plugin_dir=$TTO_VM_PLUGIN_DIR; $idle"
log "idle check passed"
