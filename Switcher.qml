pragma ComponentBehavior: Bound

import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "lib/Session.js" as Session
import "lib/Filter.js" as ItemFilter
import "lib/Keys.js" as KeyRouter
import "lib/Recency.js" as Recency
import "lib/Windows.js" as Windows

// TapTheTab's overlay: every window, most recently used first, with search.
// Summoned through the shell for now (hold-Alt arrives later). Logic lives in
// lib/; this file wires Hyprland and Quickshell to it and draws the list.
//
// The plugin is kept loaded, so the MRU tracker below runs from shell start.
// It only reacts to Hyprland events: no timers, no processes.
Item {
  id: root

  property var shell: null
  property var manifest: null

  property bool opened: false
  // Session.js state while open, null while closed.
  property var session: null
  // Recency.js state for the life of the plugin, changed in place.
  property var recency: Recency.create()
  // Whether the MRU order has been seeded from Hyprland's focus history.
  property bool seeded: false
  // The item being activated, until the overlay's layer is gone and the focus
  // dispatch has gone out once more (see activate).
  property var pendingFocus: null

  readonly property string pluginId: (root.manifest && root.manifest.id) || "memoliertorerr.tapthetab"
  readonly property string layerNamespace: "tapthetab"
  readonly property var rows: root.session ? root.session.visible : []
  readonly property int selectedIndex: root.session && root.session.selectedIndex !== null ? root.session.selectedIndex : -1
  readonly property string query: root.session ? root.session.query : ""
  readonly property int itemCount: root.session ? root.session.items.length : 0

  property color background: Commons.Color.menu.background
  property color foreground: Commons.Color.menu.text
  property color border: Commons.Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Commons.Color.menu.scrim
  property color selectedBackground: Commons.Color.menu.selectedBackground
  property color selectedText: Commons.Color.menu.selectedText
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  property int contentSpacing: Style.spacing.md
  property int rowPadding: Style.spacing.rowPaddingX
  property int headerHeight: Math.max(Style.space(34), Style.font.heading + Style.spacing.controlPaddingY * 2)
  property int rowHeight: Math.max(Style.space(32), Style.font.body + Style.spacing.controlPaddingY * 2)
  // Sized for every window, not the matches, so typing never resizes the card.
  property int listHeight: root.rowHeight * Math.max(1, Math.min(10, root.itemCount))
  property int cardWidth: Math.min(Style.space(560), panel.width - Style.gapsOut * 2)
  property int cardHeight: Math.min(root.headerHeight + root.contentSpacing + root.listHeight + root.contentMargin * 2, panel.height - Style.gapsOut * 2)

  function open(payloadJson) {
    const snapshots = root.snapshotWindows()
    root.pendingFocus = null
    if (!root.seeded) root.seeded = Windows.seed(root.recency, snapshots)
    Windows.forgetMissing(root.recency, snapshots)
    root.session = Session.create(root.listItems(snapshots), {})
    root.opened = true
    Qt.callLater(function() {
      keyCatcher.forceActiveFocus()
      list.positionViewAtBeginning()
    })
  }

  function close() {
    root.opened = false
    root.session = null
  }

  function dismiss() {
    root.close()
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
  }

  // Plain descriptions of Hyprland's toplevels, in the snapshot shape
  // documented in lib/Windows.js. Windows.js decides what gets listed.
  function snapshotWindows() {
    const out = []
    const toplevels = Hyprland.toplevels.values
    for (let i = 0; i < toplevels.length; i++) {
      const toplevel = toplevels[i]
      const wayland = toplevel.wayland
      const workspace = toplevel.workspace
      const ipc = toplevel.lastIpcObject || {}
      out.push({
        address: String(toplevel.address || ""),
        // Hyprland's class is the app id; it fills in while the Wayland handle
        // hasn't arrived yet.
        appId: String((wayland && wayland.appId) || ipc.class || ""),
        title: String(toplevel.title || (wayland ? wayland.title : "") || ""),
        parented: !!(wayland && wayland.parent),
        workspace: workspace ? { id: workspace.id, name: String(workspace.name || "") } : null,
        monitor: toplevel.monitor ? String(toplevel.monitor.name || "") : "",
        focusHistoryID: typeof ipc.focusHistoryID === "number" ? ipc.focusHistoryID : null,
        pid: typeof ipc.pid === "number" ? ipc.pid : null
      })
    }
    return out
  }

  // The workspace in front of the user as {id, name}, or null when unknown.
  // The focused monitor's regular workspace, not a special one shown over it.
  function activeWorkspace() {
    const monitor = Hyprland.focusedMonitor
    const workspace = monitor && monitor.activeWorkspace ? monitor.activeWorkspace : Hyprland.focusedWorkspace
    return workspace ? { id: workspace.id, name: String(workspace.name || "") } : null
  }

  function listItems(snapshots) {
    const workspace = root.activeWorkspace()
    const items = Windows.items(snapshots, root.recency, { activeWorkspaceId: workspace ? workspace.id : null })
    return ItemFilter.apply(items, {}, "allWindows", {})
  }

  // A window opened, closed or moved while the switcher is open.
  function reloadItems() {
    if (!root.opened || !root.session) return
    root.session = Session.replaceItems(root.session, root.listItems(root.snapshotWindows()))
  }

  // Runs one session input and acts on its effect.
  function runInput(input) {
    if (!root.session || !input) return
    const result = Session.handle(root.session, input)
    root.session = result.state
    if (result.effect.type === "activate") root.activate(result.effect.item)
    else if (result.effect.type === "dismiss") root.dismiss()
    else if (result.effect.type === "refresh") root.revealSelection()
  }

  function revealSelection() {
    Qt.callLater(function() {
      if (root.selectedIndex >= 0) list.positionViewAtIndex(root.selectedIndex, ListView.Contain)
    })
  }

  // Returns whether the key meant something. Ctrl+U and Ctrl+Backspace edit
  // the search the way Omarchy's pickers do (Util.editsFilter); everything
  // else goes through the key router.
  function handleKey(event) {
    if (!root.session) return false
    if ((event.modifiers & Qt.ControlModifier) && Util.editsFilter(event, root.query)) {
      root.trimQuery(Util.editedFilter(event, root.query))
      return true
    }
    const press = KeyRouter.fromQt(event.key, event.text, event.modifiers)
    const input = KeyRouter.route(press, {}, Session.isSearching(root.session))
    if (!input) return false
    root.runInput(input)
    return true
  }

  // Deletes from the end of the search until it is target, which is always a
  // prefix of it.
  function trimQuery(target) {
    let guard = root.query.length
    while (root.session && root.query.length > target.length && guard-- > 0) root.runInput({ type: "deleteBackward" })
  }

  function activateIndex(index) {
    root.runInput({ type: "select", index: index })
    root.runInput({ type: "commit" })
  }

  // The overlay closes first. While it holds exclusive keyboard focus,
  // Hyprland will not hand focus to a window, so the dispatch goes out now and
  // once more on this overlay's closelayer. Another window's focus event is no
  // sign the layer is gone, so only closelayer, or the chosen window itself
  // getting focus, ends the wait.
  function activate(item) {
    root.pendingFocus = item
    root.dismiss()
    root.focusWindow(item)
  }

  function focusWindow(item) {
    const steps = Windows.focusSteps(item, root.activeWorkspace())
    for (let i = 0; i < steps.length; i++) Hyprland.dispatch(steps[i])
  }

  function handleHyprlandEvent(event) {
    const name = String(event && event.name ? event.name : "")
    const data = String(event && event.data ? event.data : "")
    Windows.trackEvent(root.recency, name, data)
    if (root.pendingFocus && !root.opened) {
      const item = root.pendingFocus
      if (name === "closelayer" && data === root.layerNamespace) {
        root.pendingFocus = null
        root.focusWindow(item)
      } else if (name === "activewindowv2" && Windows.windowId(data.split(",")[0]) === item.id) {
        root.pendingFocus = null
      }
    }
    if (root.opened && Windows.changesList(name)) Qt.callLater(root.reloadItems)
  }

  // What the switcher shows, as JSON. Read-only; for tests and debugging.
  function describe() {
    return JSON.stringify({
      opened: root.opened,
      query: root.query,
      selectedIndex: root.selectedIndex,
      tracked: Recency.trackedCount(root.recency),
      rows: root.rows.map(function(row) {
        return { title: row.item.title, appName: row.item.appName, appId: row.item.appId, address: row.item.address, minimized: row.item.minimized }
      })
    })
  }

  // Focus history arrives with this one refresh; lastIpcObject goes stale
  // after it, so open() seeds from it once and focus events do the rest.
  Component.onCompleted: {
    if (typeof Hyprland.refreshToplevels === "function") Hyprland.refreshToplevels()
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) { root.handleHyprlandEvent(event) }
  }

  // While open, a window's Wayland handle (its app id) or title can arrive
  // after the raw event that announced it; rebuild when they do. Bound
  // properties rather than named signals, so nothing depends on Quickshell's
  // signal names. Inactive while closed.
  Instantiator {
    active: root.opened
    model: Hyprland.toplevels
    delegate: QtObject {
      required property var modelData
      readonly property var handle: modelData.wayland
      readonly property string title: modelData.title || ""
      onHandleChanged: Qt.callLater(root.reloadItems)
      onTitleChanged: Qt.callLater(root.reloadItems)
    }
  }

  // `omarchy-shell tapthetab state` prints what the switcher shows. The
  // TapTheTab verbs (next, prev, commit, cancel) join this target later.
  IpcHandler {
    target: "tapthetab"

    function state(): string {
      return root.describe()
    }
  }

  // A plain PanelWindow, as the emoji picker in stable Omarchy (4.0.x) builds
  // its overlay. qs.Ui's OverlayWindow only exists on Omarchy's development
  // branch; switch to it once a stable release ships it.
  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: root.layerNamespace
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: root.cardHeight
      radius: root.cornerRadius
      anchors.centerIn: parent
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true

        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          event.accepted = root.handleKey(event)
        }
      }

      Column {
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        spacing: root.contentSpacing

        Text {
          width: parent.width
          height: root.headerHeight
          leftPadding: root.rowPadding
          rightPadding: root.rowPadding
          verticalAlignment: Text.AlignVCenter
          textFormat: Text.PlainText
          text: root.query || "Search windows…"
          color: root.foreground
          opacity: root.query ? 1 : 0.58
          font.family: root.fontFamily
          font.pixelSize: Style.font.heading
          elide: Text.ElideRight
        }

        Item {
          width: parent.width
          height: parent.height - root.headerHeight - root.contentSpacing

          ListView {
            id: list
            anchors.fill: parent
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            model: root.rows

            delegate: Rectangle {
              id: row
              required property var modelData
              required property int index
              readonly property bool selected: row.index === root.selectedIndex
              readonly property color textColor: row.selected ? root.selectedText : root.foreground

              width: list.width
              height: root.rowHeight
              radius: root.cornerRadius
              color: row.selected ? root.selectedBackground : "transparent"

              Text {
                id: appLabel
                anchors.left: parent.left
                anchors.leftMargin: root.rowPadding
                anchors.verticalCenter: parent.verticalCenter
                width: Math.min(appLabel.implicitWidth, row.width * 0.3)
                textFormat: Text.PlainText
                text: row.modelData.item.appName
                color: row.textColor
                opacity: 0.7
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                elide: Text.ElideRight
              }

              Text {
                anchors.left: appLabel.right
                anchors.leftMargin: root.contentSpacing
                anchors.right: parent.right
                anchors.rightMargin: root.rowPadding
                anchors.verticalCenter: parent.verticalCenter
                textFormat: Text.PlainText
                text: row.modelData.item.title || row.modelData.item.appName
                color: row.textColor
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                elide: Text.ElideRight
              }

              MouseArea {
                anchors.fill: parent
                onClicked: root.activateIndex(row.index)
              }
            }
          }

          Text {
            anchors.centerIn: parent
            visible: root.rows.length === 0
            textFormat: Text.PlainText
            text: root.query ? "No windows match “" + root.query + "”" : "No windows"
            color: root.foreground
            opacity: 0.7
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
          }
        }
      }
    }
  }
}
