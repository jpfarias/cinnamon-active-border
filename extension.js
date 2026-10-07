// Active Window Border — a Cinnamon extension.
//
// Draws a colored border around the focused window using a compositor-level
// St.Widget, so the active window is easy to spot. Because it works at the
// window-actor level it also covers client-side-decorated windows
// (Nemo, xed, Chromium, Qt, Wine, ...), which a Metacity window theme cannot.

const { GLib, Meta, St } = imports.gi;
const Settings = imports.ui.settings;

let manager = null;

function init(metadata) {
    manager = new ActiveWindowBorder(metadata.uuid);
}

function enable() {
    if (manager) manager.enable();
}

function disable() {
    if (manager) manager.disable();
}

class ActiveWindowBorder {
    constructor(uuid) {
        this._uuid = uuid;
        this._entries = new Map();   // Meta.Window -> { border, actor, active, connections }
        this._displaySignals = [];
        this._workspaceSignal = 0;
        this._settings = null;

        // Defaults, overwritten by the extension settings.
        this.color = '#74c7ec';
        this.width = 3;
        this.radius = 12;
        this.inactiveColor = '#313244';
        this.showInactive = false;
        this.hideOnMaximized = false;
    }

    enable() {
        this._initSettings();

        this._displaySignals.push(
            global.display.connect('window-created', (display, metaWindow) => {
                this._addWindow(metaWindow);
            }));

        this._displaySignals.push(
            global.display.connect('notify::focus-window', () => {
                this._updateAll();
            }));

        this._displaySignals.push(
            global.display.connect('restacked', () => {
                this._restackAll();
            }));

        this._workspaceSignal = global.workspace_manager.connect('workspace-switched', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._updateAll();
                this._restackAll();
                return GLib.SOURCE_REMOVE;
            });
        });

        this._forEachActor(actor => this._addWindow(actor.meta_window));
    }

    disable() {
        this._removeAll();

        this._displaySignals.forEach(id => {
            try { global.display.disconnect(id); } catch (e) {}
        });
        this._displaySignals = [];

        if (this._workspaceSignal) {
            try { global.workspace_manager.disconnect(this._workspaceSignal); } catch (e) {}
            this._workspaceSignal = 0;
        }

        if (this._settings) {
            this._settings.finalize();
            this._settings = null;
        }
    }

    _initSettings() {
        this._settings = new Settings.ExtensionSettings(this, this._uuid);
        this._settings.bind('border-color', 'color', () => this._restyleAll());
        this._settings.bind('border-width', 'width', () => this._restyleAll());
        this._settings.bind('border-radius', 'radius', () => this._restyleAll());
        this._settings.bind('inactive-border', 'showInactive', () => this._restyleAll());
        this._settings.bind('inactive-color', 'inactiveColor', () => this._restyleAll());
        this._settings.bind('hide-on-maximized', 'hideOnMaximized', () => this._updateAll());
    }

    _forEachActor(callback) {
        Meta.get_window_actors(global.display).forEach(callback);
    }

    // Windows we may draw a border around. Everything else (desktop,
    // panels/docks, menus, override-redirect windows, ...) must be ignored.
    _isBorderable(metaWindow) {
        if (!metaWindow) return false;

        let type;
        try {
            type = metaWindow.get_window_type();
        } catch (e) {
            return false;
        }

        if (type !== Meta.WindowType.NORMAL &&
            type !== Meta.WindowType.DIALOG &&
            type !== Meta.WindowType.MODAL_DIALOG) {
            return false;
        }

        // Muffin reports window-type as NORMAL by default until the real type
        // is resolved, so guard against override-redirect windows too.
        try {
            if (metaWindow.is_override_redirect()) return false;
        } catch (e) {}

        return true;
    }

    _addWindow(metaWindow) {
        if (!metaWindow || this._entries.has(metaWindow)) return;
        if (!this._isBorderable(metaWindow)) return;

        this._createBorder(metaWindow, 0);
    }

    _createBorder(metaWindow, retry) {
        if (this._entries.has(metaWindow)) return;

        // Re-check on every attempt: a window's type can still be the default
        // NORMAL when window-created fires and resolve to its real type
        // (DESKTOP, DOCK, OVERRIDE_OTHER, ...) a moment later.
        if (!this._isBorderable(metaWindow)) return;

        const actor = metaWindow.get_compositor_private();
        if (!actor || !actor.get_parent()) {
            // The actor may not be mapped/parented yet; retry briefly.
            if (retry < 20) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._createBorder(metaWindow, retry + 1);
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }

        const border = new St.Widget({ reactive: false, track_hover: false, width: 1, height: 1 });

        const entry = { border, actor, active: null, connections: [] };
        const on = (obj, signal) => {
            entry.connections.push({ obj, id: obj.connect(signal, () => this._updateBorder(metaWindow)) });
        };

        on(metaWindow, 'position-changed');
        on(metaWindow, 'size-changed');
        on(metaWindow, 'notify::minimized');
        on(metaWindow, 'notify::fullscreen');
        on(metaWindow, 'notify::maximized-horizontally');
        on(metaWindow, 'notify::maximized-vertically');
        on(metaWindow, 'notify::workspace');
        on(metaWindow, 'notify::monitor');
        entry.connections.push({
            obj: metaWindow,
            id: metaWindow.connect('notify::window-type', () => this._onWindowTypeChanged(metaWindow))
        });
        entry.connections.push({
            obj: metaWindow,
            id: metaWindow.connect('unmanaging', () => this._removeBorder(metaWindow))
        });

        if (typeof actor.connect === 'function') {
            on(actor, 'notify::visible');
            on(actor, 'notify::mapped');
        }

        this._entries.set(metaWindow, entry);

        // Place the border just above the window actor so the window's drop
        // shadow doesn't dim it, while still staying below higher windows.
        const parent = actor.get_parent();
        if (parent) {
            try { parent.insert_child_above(border, actor); } catch (e) {}
        }

        this._applyStyle(entry, false);
        this._updateBorder(metaWindow);
    }

    _styleString(isActive) {
        const color = isActive ? this.color : this.inactiveColor;
        return 'background-color: transparent; ' +
               'border: ' + this.width + 'px solid ' + color + '; ' +
               'border-radius: ' + this.radius + 'px;';
    }

    _applyStyle(entry, isActive) {
        entry.border.set_style(this._styleString(isActive));
    }

    _updateBorder(metaWindow) {
        const entry = this._entries.get(metaWindow);
        if (!entry) return;

        // The window may have stopped being borderable since it was added
        // (e.g. its type resolved to DESKTOP). Remove the stray border.
        if (!this._isBorderable(metaWindow)) {
            this._removeBorder(metaWindow);
            return;
        }

        const isActive = (metaWindow === global.display.focus_window);
        if (entry.active !== isActive) {
            entry.active = isActive;
            this._applyStyle(entry, isActive);
        }

        const actor = metaWindow.get_compositor_private() || entry.actor;
        const maximizedH = metaWindow.maximized_horizontally;
        const maximizedV = metaWindow.maximized_vertically;

        const shouldHide = metaWindow.minimized ||
            metaWindow.fullscreen ||
            metaWindow.is_hidden() ||
            !actor || !actor.visible ||
            (this.hideOnMaximized && (maximizedH || maximizedV));

        if (shouldHide || (!isActive && !this.showInactive)) {
            entry.border.hide();
            return;
        }

        const rect = metaWindow.get_frame_rect();
        if (rect.width <= 0 || rect.height <= 0) {
            entry.border.hide();
            return;
        }

        // Extend the border outward where there is room, but inset it on any
        // side flush against a monitor edge so the stroke never gets clipped
        // off-screen (e.g. a window snapped to the left edge or maximized).
        const w = this.width;
        let mon = null;
        try { mon = global.display.get_monitor_geometry(metaWindow.get_monitor()); } catch (e) {}
        let extL = w, extT = w, extR = w, extB = w;
        if (mon) {
            if (rect.x - w < mon.x) extL = 0;
            if (rect.y - w < mon.y) extT = 0;
            if (rect.x + rect.width + w > mon.x + mon.width) extR = 0;
            if (rect.y + rect.height + w > mon.y + mon.height) extB = 0;
        }

        entry.border.set_position(rect.x - extL, rect.y - extT);
        entry.border.set_size(rect.width + extL + extR, rect.height + extT + extB);
        entry.border.show();
    }

    // Called when Muffin resolves/changes a window's type after creation. The
    // default type is NORMAL, so a window that is really the desktop, a dock,
    // etc. can be seen as borderable at window-created and change later.
    _onWindowTypeChanged(metaWindow) {
        if (this._entries.has(metaWindow)) {
            if (!this._isBorderable(metaWindow))
                this._removeBorder(metaWindow);
            else
                this._updateBorder(metaWindow);
            return;
        }

        this._addWindow(metaWindow);
    }

    _restackAll() {
        this._forEachActor(actor => {
            const metaWindow = actor.meta_window;
            if (!metaWindow) return;
            const entry = this._entries.get(metaWindow);
            if (!entry || !entry.border.visible) return;
            this._restackEntry(entry, actor);
        });
    }

    _restackEntry(entry, actor) {
        const parent = actor.get_parent();
        if (!parent) return;

        const currentParent = entry.border.get_parent();
        if (currentParent !== parent) {
            if (currentParent) {
                try { currentParent.remove_child(entry.border); } catch (e) {}
            }
            try { parent.insert_child_above(entry.border, actor); } catch (e) {}
        } else {
            try { parent.set_child_above_sibling(entry.border, actor); } catch (e) {}
        }
        entry.actor = actor;
    }

    _restyleAll() {
        this._entries.forEach((entry, metaWindow) => {
            entry.active = null; // force a restyle
            this._updateBorder(metaWindow);
        });
    }

    _updateAll() {
        this._entries.forEach((entry, metaWindow) => this._updateBorder(metaWindow));
    }

    _removeBorder(metaWindow) {
        const entry = this._entries.get(metaWindow);
        if (!entry) return;

        entry.connections.forEach(c => {
            try { c.obj.disconnect(c.id); } catch (e) {}
        });
        try { entry.border.destroy(); } catch (e) {}
        this._entries.delete(metaWindow);
    }

    _removeAll() {
        Array.from(this._entries.keys()).forEach(metaWindow => this._removeBorder(metaWindow));
    }
}
