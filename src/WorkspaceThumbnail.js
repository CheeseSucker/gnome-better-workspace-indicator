const WindowClone = imports.misc.extensionUtils.getCurrentExtension().imports.src.WindowClone.WindowClone;

const { Clutter, GLib, GObject, Graphene, Meta, St } = imports.gi;
const Util = imports.misc.util;

const Main = imports.ui.main;
const BackgroundManager = imports.ui.background.BackgroundManager

/**
 * @metaWorkspace: a #Meta.Workspace
 */
 var WorkspaceThumbnail = GObject.registerClass({
    Properties: {
    },
}, class WorkspaceThumbnail extends St.Widget {
    _init(metaWorkspace, monitorIndex) {
        super._init({
            clip_to_allocation: true,
            style_class: 'workspace-thumbnail',
            pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }),
        });
        this._delegate = this;

        this.metaWorkspace = metaWorkspace;
        this.monitorIndex = monitorIndex;

        this._removed = false;

        this._viewport = new Clutter.Actor();
        this.add_child(this._viewport);

        this._contents = new Clutter.Actor();
        this._viewport.add_child(this._contents);

        this.connect('destroy', this._onDestroy.bind(this));

        let workArea = Main.layoutManager.getWorkAreaForMonitor(this.monitorIndex);
        this.setPorthole(workArea.x, workArea.y, workArea.width, workArea.height);

        let windows = global.get_window_actors().filter(actor => {
            let win = actor.meta_window;
            return win.located_on_workspace(metaWorkspace);
        });

        // Create clones for windows that should be visible in the Overview
        this._windows = [];
        this._allWindows = [];
        for (let i = 0; i < windows.length; i++) {
            windows[i].meta_window.connectObject('notify::minimized',
                this._updateMinimized.bind(this), this);
            this._allWindows.push(windows[i].meta_window);

            if (this._isMyWindow(windows[i]) && this._isOverviewWindow(windows[i]))
                this._addWindowClone(windows[i]);
        }

        // Track window changes
        this.metaWorkspace.connectObject(
            'window-added', this._windowAdded.bind(this),
            'window-removed', this._windowRemoved.bind(this), this);
        global.display.connectObject(
            'window-entered-monitor', this._windowEnteredMonitor.bind(this),
            'window-left-monitor', this._windowLeftMonitor.bind(this), this);

        this._bgManager = new BackgroundManager({
            monitorIndex: monitorIndex,
            container: this._contents,
            vignette: false
        });
    }

    setPorthole(x, y, width, height) {
        this._viewport.set_size(width, height);
        this._contents.set_position(-x, -y);
    }

    _lookupIndex(metaWindow) {
        return this._windows.findIndex(w => w.metaWindow == metaWindow);
    }

    syncStacking(stackIndices) {
        this._windows.sort((a, b) => {
            let indexA = stackIndices[a.metaWindow.get_stable_sequence()];
            let indexB = stackIndices[b.metaWindow.get_stable_sequence()];
            return indexA - indexB;
        });

        for (let i = 1; i < this._windows.length; i++) {
            let clone = this._windows[i];
            const previousClone = this._windows[i - 1];
            clone.setStackAbove(previousClone);
        }
    }

    _doRemoveWindow(metaWin) {
        let clone = this._removeWindowClone(metaWin);
        if (clone)
            clone.destroy();
    }

    _doAddWindow(metaWin) {
        if (this._removed)
            return;

        let win = metaWin.get_compositor_private();

        if (!win) {
            // Newly-created windows are added to a workspace before
            // the compositor finds out about them...
            let id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (!this._removed &&
                    metaWin.get_compositor_private() &&
                    metaWin.get_workspace() == this.metaWorkspace)
                    this._doAddWindow(metaWin);
                return GLib.SOURCE_REMOVE;
            });
            GLib.Source.set_name_by_id(id, '[gnome-shell] this._doAddWindow');
            return;
        }

        if (!this._allWindows.includes(metaWin)) {
            metaWin.connectObject('notify::minimized',
                this._updateMinimized.bind(this), this);
            this._allWindows.push(metaWin);
        }

        // We might have the window in our list already if it was on all workspaces and
        // now was moved to this workspace
        if (this._lookupIndex(metaWin) != -1)
            return;

        if (!this._isMyWindow(win))
            return;

        if (this._isOverviewWindow(win)) {
            this._addWindowClone(win);
        } else if (metaWin.is_attached_dialog()) {
            let parent = metaWin.get_transient_for();
            while (parent.is_attached_dialog())
                parent = parent.get_transient_for();

            let idx = this._lookupIndex(parent);
            if (idx < 0) {
                // parent was not created yet, it will take care
                // of the dialog when created
                return;
            }

            let clone = this._windows[idx];
            clone.addAttachedDialog(metaWin);
        }
    }

    _windowAdded(metaWorkspace, metaWin) {
        this._doAddWindow(metaWin);
    }

    _windowRemoved(metaWorkspace, metaWin) {
        let index = this._allWindows.indexOf(metaWin);
        if (index != -1) {
            metaWin.disconnectObject(this);
            this._allWindows.splice(index, 1);
        }

        this._doRemoveWindow(metaWin);
    }

    _windowEnteredMonitor(metaDisplay, monitorIndex, metaWin) {
        if (monitorIndex == this.monitorIndex)
            this._doAddWindow(metaWin);
    }

    _windowLeftMonitor(metaDisplay, monitorIndex, metaWin) {
        if (monitorIndex == this.monitorIndex)
            this._doRemoveWindow(metaWin);
    }

    _updateMinimized(metaWin) {
        if (metaWin.minimized)
            this._doRemoveWindow(metaWin);
        else
            this._doAddWindow(metaWin);
    }

    workspaceRemoved() {
        if (this._removed)
            return;

        this._removed = true;

        this.metaWorkspace.disconnectObject(this);
        global.display.disconnectObject(this);
        this._allWindows.forEach(w => w.disconnectObject(this));
    }

    _onDestroy() {
        this.workspaceRemoved();
        this._windows = [];

        if (this._bgManager) {
            this._bgManager.destroy();
            this._bgManager = null;
        }
    }

    // Tests if @actor belongs to this workspace and monitor
    _isMyWindow(actor) {
        let win = actor.meta_window;
        return win.located_on_workspace(this.metaWorkspace) &&
            (win.get_monitor() == this.monitorIndex);
    }

    // Tests if @win should be shown in the Overview
    _isOverviewWindow(win) {
        return !win.get_meta_window().skip_taskbar &&
               win.get_meta_window().showing_on_its_workspace();
    }

    // Create a clone of a (non-desktop) window and add it to the window list
    _addWindowClone(win) {
        let clone = new WindowClone(win);

        clone.connect('selected', (o, time) => {
            this.activate(time);
        });
        clone.connect('destroy', () => {
            this._removeWindowClone(clone.metaWindow);
        });
        this._contents.add_actor(clone);

        if (this._windows.length > 0)
            clone.setStackAbove(this._windows[this._windows.length - 1]);

        this._windows.push(clone);

        return clone;
    }

    _removeWindowClone(metaWin) {
        // find the position of the window in our list
        let index = this._lookupIndex(metaWin);

        if (index == -1)
            return null;

        return this._windows.splice(index, 1).pop();
    }

    activate(time) {
        if (!this.metaWorkspace.active) {
            this.metaWorkspace.activate(time);
        }
    }

    setScale(scaleX, scaleY) {
        this._viewport.set_scale(scaleX, scaleY);
    }
});

