const { Clutter, GObject } = imports.gi;

const PrimaryActorLayout = imports.misc.extensionUtils.getCurrentExtension().imports.src.WorkspaceThumbnail.PrimaryActorLayout.PrimaryActorLayout;

var WindowClone = GObject.registerClass(
class WindowClone extends Clutter.Actor {
    _init(realWindow) {
        let clone = new Clutter.Clone({ source: realWindow });
        super._init({
            layout_manager: new PrimaryActorLayout(clone),
            reactive: false,
        });

        this.add_child(clone);
        this.realWindow = realWindow;
        this.metaWindow = realWindow.meta_window;

        this.realWindow.connectObject(
            'notify::position', this._onPositionChanged.bind(this),
            'destroy', () => {
                // First destroy the clone and then destroy everything
                // This will ensure that we never see it in the _disconnectSignals loop
                clone.destroy();
                this.destroy();
            }, this);
        this._onPositionChanged();

        let iter = win => {
            let actor = win.get_compositor_private();

            if (!actor)
                return false;
            if (!win.is_attached_dialog())
                return false;

            this._doAddAttachedDialog(win, actor);
            win.foreach_transient(iter);

            return true;
        };
        this.metaWindow.foreach_transient(iter);
    }

    // Find the actor just below us, respecting reparenting done
    // by DND code
    getActualStackAbove() {
        if (this._stackAbove == null)
            return null;

        return this._stackAbove;
    }

    setStackAbove(actor) {
        this._stackAbove = actor;

        let parent = this.get_parent();
        let actualAbove = this.getActualStackAbove();
        if (actualAbove == null)
            parent.set_child_below_sibling(this, null);
        else
            parent.set_child_above_sibling(this, actualAbove);
    }

    addAttachedDialog(win) {
        this._doAddAttachedDialog(win, win.get_compositor_private());
    }

    _doAddAttachedDialog(metaDialog, realDialog) {
        let clone = new Clutter.Clone({ source: realDialog });
        this._updateDialogPosition(realDialog, clone);

        realDialog.connectObject(
            'notify::position', dialog => this._updateDialogPosition(dialog, clone),
            'destroy', () => clone.destroy(), this);
        this.add_child(clone);
    }

    _updateDialogPosition(realDialog, cloneDialog) {
        let metaDialog = realDialog.meta_window;
        let dialogRect = metaDialog.get_frame_rect();
        let rect = this.metaWindow.get_frame_rect();

        cloneDialog.set_position(dialogRect.x - rect.x, dialogRect.y - rect.y);
    }

    _onPositionChanged() {
        this.set_position(this.realWindow.x, this.realWindow.y);
    }
});
