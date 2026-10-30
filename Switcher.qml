import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// TapTheTab's overlay. For now a skeleton: it lists the open windows and
// closes on Escape. Ordering, search and switching arrive with the core model.
Item {
  id: root

  property var shell: null
  property var manifest: null

  property bool opened: false
  property var windows: []

  property color background: Commons.Color.menu.background
  property color foreground: Commons.Color.menu.text
  property color border: Commons.Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Commons.Color.menu.scrim
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  property int rowHeight: Math.max(Style.space(32), Style.font.body + Style.spacing.controlPaddingY * 2)
  property int cardWidth: Math.min(Style.space(560), panel.width - Style.gapsOut * 2)
  property int cardHeight: Math.min(rowHeight * Math.max(1, Math.min(10, windows.length)) + contentMargin * 2, panel.height - Style.gapsOut * 2)

  function open(payloadJson) {
    root.windows = root.snapshotWindows()
    root.opened = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide((root.manifest && root.manifest.id) || "memoliertorerr.tapthetab")
  }

  // Plain window descriptions from Hyprland's toplevels. Entries without an
  // app id, and child windows such as dialogs, are skipped like the dock does.
  function snapshotWindows() {
    var out = []
    var toplevels = Hyprland.toplevels.values
    for (var i = 0; i < toplevels.length; i++) {
      var toplevel = toplevels[i].wayland
      if (!toplevel || !toplevel.appId || toplevel.parent) continue
      out.push({ address: String(toplevels[i].address || ""), appId: String(toplevel.appId), title: String(toplevel.title || "") })
    }
    return out
  }

  // A plain PanelWindow, as the emoji picker in stable Omarchy (4.0.x) builds
  // its overlay. qs.Ui's OverlayWindow only exists on Omarchy's development
  // branch; switch to it once a stable release ships it.
  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "tapthetab"
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
          if (event.key === Qt.Key_Escape) {
            root.dismiss()
            event.accepted = true
          }
        }
      }

      ListView {
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        clip: true
        interactive: false
        model: root.windows

        delegate: Item {
          required property var modelData
          width: ListView.view.width
          height: root.rowHeight

          Text {
            textFormat: Text.PlainText
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            text: modelData.title ? modelData.appId + "  " + modelData.title : modelData.appId
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            elide: Text.ElideRight
          }
        }
      }
    }
  }
}
