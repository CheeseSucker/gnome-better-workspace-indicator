const { Clutter, GLib, GObject, Graphene, St } = imports.gi;

const DND = imports.ui.dnd;
const Main = imports.ui.main;
const Util = imports.misc.util;
const BackgroundManager = imports.ui.background.BackgroundManager;

const WindowClone = imports.misc.extensionUtils.getCurrentExtension().imports.src.WorkspaceThumbnail.WindowClone.WindowClone;

var ThumbnailState = {
    NEW:            0,
    EXPANDING:      1,
    EXPANDED:       2,
    ANIMATING_IN:   3,
    NORMAL:         4,
    REMOVING:       5,
    ANIMATING_OUT:  6,
    ANIMATED_OUT:   7,
    COLLAPSING:     8,
    DESTROYED:      9,
};

/**
 * @metaWorkspace: a #Meta.Workspace
 */
var WorkspaceThumbnail = GObject.registerClass({
    Properties: {
        'collapse-fraction': GObject.ParamSpec.double(
            'collapse-fraction', 'collapse-fraction', 'collapse-fraction',
            GObject.ParamFlags.READWRITE,
            0, 1, 0),
        'slide-position': GObject.ParamSpec.double(
            'slide-position', 'slide-position', 'slide-position',
            GObject.ParamFlags.READWRITE,
            0, 1, 0),
    },
}, class WorkspaceThumbnail extends St.Widget
{
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

        this.state = ThumbnailState.NORMAL;
        this._slidePosition = 0; // Fully slid in
        this._collapseFraction = 0; // Not collapsed

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

    set slidePosition(slidePosition) {
        if (this._slidePosition == slidePosition)
            return;

        const scale = Util.lerp(1, 0.75, slidePosition);
        this.set_scale(scale, scale);
        this.opacity = Util.lerp(255, 0, slidePosition);

        this._slidePosition = slidePosition;
        this.notify('slide-position');
        this.queue_relayout();
    }

    get slidePosition() {
        return this._slidePosition;
    }

    set collapseFraction(collapseFraction) {
        if (this._collapseFraction == collapseFraction)
            return;
        this._collapseFraction = collapseFraction;
        this.notify('collapse-fraction');
        this.queue_relayout();
    }

    get collapseFraction() {
        return this._collapseFraction;
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
        clone.connect('drag-begin', () => {
            Main.overview.beginWindowDrag(clone.metaWindow);
        });
        clone.connect('drag-cancelled', () => {
            Main.overview.cancelledWindowDrag(clone.metaWindow);
        });
        clone.connect('drag-end', () => {
            Main.overview.endWindowDrag(clone.metaWindow);
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
        if (this.state > ThumbnailState.NORMAL)
            return;

        // a click on the already current workspace should go back to the main view
        if (this.metaWorkspace.active)
            Main.overview.hide();
        else
            this.metaWorkspace.activate(time);
    }

    // Draggable target interface used only by ThumbnailsBox
    handleDragOverInternal(source, actor, time) {
        if (source == Main.xdndHandler) {
            this.metaWorkspace.activate(time);
            return DND.DragMotionResult.CONTINUE;
        }

        if (this.state > ThumbnailState.NORMAL)
            return DND.DragMotionResult.CONTINUE;

        if (source.metaWindow &&
            !this._isMyWindow(source.metaWindow.get_compositor_private()))
            return DND.DragMotionResult.MOVE_DROP;
        if (source.app && source.app.can_open_new_window())
            return DND.DragMotionResult.COPY_DROP;
        if (!source.app && source.shellWorkspaceLaunch)
            return DND.DragMotionResult.COPY_DROP;

        return DND.DragMotionResult.CONTINUE;
    }

    acceptDropInternal(source, actor, time) {
        if (this.state > ThumbnailState.NORMAL)
            return false;

        if (source.metaWindow) {
            let win = source.metaWindow.get_compositor_private();
            if (this._isMyWindow(win))
                return false;

            let metaWindow = win.get_meta_window();
            Main.moveWindowToMonitorAndWorkspace(metaWindow,
                this.monitorIndex, this.metaWorkspace.index());
            return true;
        } else if (source.app && source.app.can_open_new_window()) {
            if (source.animateLaunchAtPos)
                source.animateLaunchAtPos(actor.x, actor.y);

            source.app.open_new_window(this.metaWorkspace.index());
            return true;
        } else if (!source.app && source.shellWorkspaceLaunch) {
            // While unused in our own drag sources, shellWorkspaceLaunch allows
            // extensions to define custom actions for their drag sources.
            source.shellWorkspaceLaunch({
                workspace: this.metaWorkspace.index(),
                timestamp: time,
            });
            return true;
        }

        return false;
    }

    setScale(scaleX, scaleY) {
        this._viewport.set_scale(scaleX, scaleY);
    }
});
