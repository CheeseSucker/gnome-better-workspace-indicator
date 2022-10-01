const { Clutter, GObject, Meta, St } = imports.gi;

const Main = imports.ui.main;
const { TransientSignalHolder } = imports.misc.signalTracker;

const Thumbnail = imports.misc.extensionUtils.getCurrentExtension().imports.src.Thumbnail.Thumbnail;

var ThumbnailsBox = GObject.registerClass(
    class ThumbnailsBox extends St.Widget {
    _init(monitorIndex) {
        super._init({
            style_class: 'cheese-workspace-thumbnails',
            reactive: true,
            layout_manager: new Clutter.BoxLayout({
                homogeneous: true,
                orientation: Clutter.Orientation.HORIZONTAL,
            }),
        });

        this._monitorIndex = monitorIndex;
        this._thumbnails = [];

        Main.layoutManager.connectObject('monitors-changed', () => {
            this.setMonitorIndex(Main.layoutManager.primaryIndex);
            this._rebuildThumbnails();
        }, this);

        // The porthole is the part of the screen we're showing in the thumbnails
        global.display.connectObject('workareas-changed',
            () => {
                this._updatePorthole();
                this._rebuildThumbnails();
                this.queue_relayout();
            },
            this
        );

        this.connect('destroy', () => this._onDestroy());
        this.connect('scroll-event', this._onScrollEvent.bind(this));

        this._updatePorthole();
        this._createThumbnails();
    }

    setMonitorIndex(monitorIndex) {
        this._monitorIndex = monitorIndex;
    }

    _onDestroy() {
        this._destroyThumbnails();
    }

    _rebuildThumbnails() {
        this._destroyThumbnails();
        this._createThumbnails();
    }

    _createThumbnails() {
        if (this._thumbnails.length > 0)
            return;

        const { workspaceManager } = global;
        this._transientSignalHolder = new TransientSignalHolder(this);
        workspaceManager.connectObject(
            'notify::n-workspaces', this._rebuildThumbnails.bind(this),
            'workspace-switched', () => this._updateIndicator(),
            'workspaces-reordered', () => {
                this._thumbnails.sort((a, b) => {
                    return a.metaWorkspace.index() - b.metaWorkspace.index();
                });
                this.queue_relayout();
            }, this._transientSignalHolder);
        Main.overview.connectObject('windows-restacked',
            this._syncStacking.bind(this), this._transientSignalHolder);

        this.addThumbnails(0, workspaceManager.n_workspaces);
    }

    _destroyThumbnails() {
        if (this._thumbnails.length == 0)
            return;

        this._transientSignalHolder.destroy();
        delete this._transientSignalHolder;

        for (let w = 0; w < this._thumbnails.length; w++) {
            this.remove_actor(this._thumbnails[w]);
            this._thumbnails[w].destroy();
        }
        this._thumbnails = [];
    }

    _updateIndicator() {
        let index = global.workspaceManager.get_active_workspace_index();
        for (let i = 0; i < this._thumbnails.length; i++) {
            this._thumbnails[i].setActive(index === i);
        }
    }

    addThumbnails(start, count) {
        const workspaceManager = global.workspace_manager;
        const activeWorkSpaceIndex = global.workspaceManager.get_active_workspace_index();

        for (let k = start; k < start + count; k++) {
            let metaWorkspace = workspaceManager.get_workspace_by_index(k);
            let thumbnail = new Thumbnail(metaWorkspace, this._porthole, this._monitorIndex);
            if (k === activeWorkSpaceIndex) {
                thumbnail.setActive(true);
            }

            //thumbnail.connect('scroll-event', this._onScrollEvent.bind(this));

            this._thumbnails.push(thumbnail);
            this.add_actor(thumbnail);
        }
    }

    _syncStacking(overview, stackIndices) {
        for (let i = 0; i < this._thumbnails.length; i++)
            this._thumbnails[i].syncStacking(stackIndices);
    }

    _updatePorthole() {
        if (!Main.layoutManager.monitors[this._monitorIndex]) {
            const { x, y, width, height } = global.stage;
            this._porthole = { x, y, width, height };
        } else {
            this._porthole = Main.layoutManager.getWorkAreaForMonitor(this._monitorIndex);
        }
    }

    _onScrollEvent(actor, event) {
        const scrollDirection = event.get_scroll_direction();
        
        let motionDirection = null;
        if (scrollDirection === Clutter.ScrollDirection.DOWN) {
            motionDirection = Meta.MotionDirection.DOWN;
        } else if (scrollDirection === Clutter.ScrollDirection.UP) {
            motionDirection = Meta.MotionDirection.UP;
        } else {
            return;
        }

        const activeWorkSpace = global.workspace_manager.get_active_workspace();
        const nextWorkSpace = activeWorkSpace.get_neighbor(motionDirection);
        nextWorkSpace.activate(event.get_time());
    }

});
