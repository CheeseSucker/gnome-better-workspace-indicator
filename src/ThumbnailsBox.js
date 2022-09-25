const WorkspaceThumbnail = imports.misc.extensionUtils.getCurrentExtension().imports.src.WorkspaceThumbnail.WorkspaceThumbnail;

const { Clutter, Gio, GLib, GObject, Graphene, Meta, Shell, St } = imports.gi;

const DND = imports.ui.dnd;
const Main = imports.ui.main;
const { TransientSignalHolder } = imports.misc.signalTracker;
const Util = imports.misc.util;
const Workspace = imports.ui.workspace;
const BackgroundManager = imports.ui.background.BackgroundManager


// The maximum size of a thumbnail is 5% the width and height of the screen
var MAX_THUMBNAIL_SCALE = 0.05;

var MUTTER_SCHEMA = 'org.gnome.mutter';

var ThumbnailsBox = GObject.registerClass({
    Properties: {
    },
}, class ThumbnailsBox extends St.Widget {
    _init(monitorIndex) {
        super._init({
            style_class: 'cheese-workspace-thumbnails',
            reactive: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }),
        });

        this._delegate = this;

        let indicator = new St.Bin({ style_class: 'workspace-thumbnail-indicator' });

        // We don't want the indicator to affect drag-and-drop
        Shell.util_set_hidden_from_pick(indicator, true);

        this._indicator = indicator;
        this.add_actor(indicator);

        this._monitorIndex = monitorIndex;

        this._scale = 0;
        this._pendingScaleUpdate = false;
        this._animatingIndicator = false;

        this._thumbnails = [];

        this._settings = new Gio.Settings({ schema_id: MUTTER_SCHEMA });

        Main.overview.connectObject('showing', () => this._createThumbnails(), this);

        Main.layoutManager.connectObject('monitors-changed', () => {
            this.setMonitorIndex(Main.layoutManager.primaryIndex);
            this._destroyThumbnails();
            this._createThumbnails();
        }, this);

        // The porthole is the part of the screen we're showing in the thumbnails
        global.display.connectObject('workareas-changed',
            () => this._updatePorthole(), this);
        this._updatePorthole();

        this.connect('destroy', () => this._onDestroy());
    }

    setMonitorIndex(monitorIndex) {
        this._monitorIndex = monitorIndex;
    }

    _onDestroy() {
        this._destroyThumbnails();

        if (this._settings)
            this._settings.run_dispose();
        this._settings = null;
    }

    _updateIndicator() {
        this.queue_relayout();
    }

    _activateThumbnailAtPoint(stageX, stageY, time) {
        const [r_, x] = this.transform_stage_point(stageX, stageY);

        const thumbnail = this._thumbnails.find(t => x >= t.x && x <= t.x + t.width);
        if (thumbnail)
            thumbnail.activate(time);
    }

    vfunc_button_release_event(buttonEvent) {
        let { x, y } = buttonEvent;
        this._activateThumbnailAtPoint(x, y, buttonEvent.time);
        return Clutter.EVENT_STOP;
    }

    vfunc_touch_event(touchEvent) {
        if (touchEvent.type == Clutter.EventType.TOUCH_END &&
            global.display.is_pointer_emulating_sequence(touchEvent.sequence)) {
            let { x, y } = touchEvent;
            this._activateThumbnailAtPoint(x, y, touchEvent.time);
        }

        return Clutter.EVENT_STOP;
    }

    _createThumbnails() {
        if (this._thumbnails.length > 0)
            return;

        const { workspaceManager } = global;
        this._transientSignalHolder = new TransientSignalHolder(this);
        workspaceManager.connectObject(
            'notify::n-workspaces', this._workspacesChanged.bind(this),
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

        for (let w = 0; w < this._thumbnails.length; w++)
            this._thumbnails[w].destroy();
        this._thumbnails = [];
    }

    _workspacesChanged() {
        this._destroyThumbnails();
        this._createThumbnails();
    }

    addThumbnails(start, count) {
        let workspaceManager = global.workspace_manager;

        for (let k = start; k < start + count; k++) {
            let metaWorkspace = workspaceManager.get_workspace_by_index(k);
            let thumbnail = new WorkspaceThumbnail(metaWorkspace, this._monitorIndex);
            thumbnail.setPorthole(this._porthole.x, this._porthole.y,
                                  this._porthole.width, this._porthole.height);
            this._thumbnails.push(thumbnail);
            this.add_actor(thumbnail);
        }

        // The thumbnails indicator actually needs to be on top of the thumbnails
        this.set_child_above_sibling(this._indicator, null);
    }

    _syncStacking(overview, stackIndices) {
        for (let i = 0; i < this._thumbnails.length; i++)
            this._thumbnails[i].syncStacking(stackIndices);
    }

    vfunc_get_preferred_height(forWidth) {
        let themeNode = this.get_theme_node();

        forWidth = themeNode.adjust_for_width(forWidth);

        let spacing = themeNode.get_length('spacing');
        let nWorkspaces = this._thumbnails.length;
        let totalSpacing = (nWorkspaces - 1) * spacing;

        const avail = forWidth - totalSpacing;

        let scale = (avail / nWorkspaces) / this._porthole.width;
        scale = Math.min(scale, MAX_THUMBNAIL_SCALE);

        console.log("Scale", scale, avail, nWorkspaces, this._porthole.width);

        const height = Math.round(this._porthole.height * scale);
        console.log("Heigh", height, this._porthole.height);
        return themeNode.adjust_preferred_height(height, height);
    }

    vfunc_get_preferred_width(_forHeight) {
        // Note that for getPreferredHeight/Width we cheat a bit and skip propagating
        // the size request to our children because we know how big they are and know
        // that the actors aren't depending on the virtual functions being called.
        let themeNode = this.get_theme_node();

        let spacing = themeNode.get_length('spacing');
        let nWorkspaces = this._thumbnails.length;
        let totalSpacing = (nWorkspaces - 1) * spacing;

        const naturalWidth = this._thumbnails.reduce((accumulator, thumbnail, index) => {
            let workspaceSpacing = 0;

            if (index > 0)
                workspaceSpacing += spacing / 2;
            if (index < this._thumbnails.length - 1)
                workspaceSpacing += spacing / 2;

            const width = this._porthole.width * MAX_THUMBNAIL_SCALE + workspaceSpacing;
            return accumulator + width;
        }, 0);

        console.log("Width", naturalWidth, totalSpacing)

        return themeNode.adjust_preferred_width(naturalWidth, naturalWidth);
    }

    _updatePorthole() {
        if (!Main.layoutManager.monitors[this._monitorIndex]) {
            const { x, y, width, height } = global.stage;
            console.log("update porthole", x, y, width, height)
            this._porthole = { x, y, width, height };
        } else {
            this._porthole = Main.layoutManager.getWorkAreaForMonitor(this._monitorIndex);
        }

        this.queue_relayout();
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        let rtl = Clutter.get_default_text_direction() == Clutter.TextDirection.RTL;

        if (this._thumbnails.length == 0) // not visible
            return;

        let themeNode = this.get_theme_node();
        box = themeNode.get_content_box(box);

        const portholeWidth = this._porthole.width;
        const portholeHeight = this._porthole.height;
        const spacing = themeNode.get_length('spacing');

        const nWorkspaces = this._thumbnails.length;

        // Compute the scale we'll need once everything is updated,
        // unless we are currently transitioning
        const totalSpacing = (nWorkspaces - 1) * spacing;
        const availableWidth = (box.get_width() - totalSpacing) / nWorkspaces;

        const hScale = availableWidth / portholeWidth;
        const vScale = box.get_height() / portholeHeight;
        const scale = Math.min(hScale, vScale);

        const ratio = portholeWidth / portholeHeight;
        const thumbnailFullHeight = Math.round(portholeHeight * scale);
        const thumbnailWidth = Math.round(thumbnailFullHeight * ratio);
        const thumbnailHeight = thumbnailFullHeight;
        const roundedVScale = thumbnailHeight / portholeHeight;

        console.log("S", thumbnailWidth, thumbnailWidth);

        // We always request size for MAX_THUMBNAIL_SCALE, distribute
        // space evently if we use smaller thumbnails
        const extraWidth =
            (MAX_THUMBNAIL_SCALE * portholeWidth - thumbnailWidth) * nWorkspaces;
        box.x1 += Math.round(extraWidth / 2);
        box.x2 -= Math.round(extraWidth / 2);

        let indicatorValue = global.workspaceManager.get_active_workspace_index();
        let indicatorUpperWs = Math.ceil(indicatorValue);
        let indicatorLowerWs = Math.floor(indicatorValue);

        let indicatorLowerX1 = 0;
        let indicatorLowerX2 = 0;
        let indicatorUpperX1 = 0;
        let indicatorUpperX2 = 0;

        let indicatorThemeNode = this._indicator.get_theme_node();
        let indicatorTopFullBorder = indicatorThemeNode.get_padding(St.Side.TOP) + indicatorThemeNode.get_border_width(St.Side.TOP);
        let indicatorBottomFullBorder = indicatorThemeNode.get_padding(St.Side.BOTTOM) + indicatorThemeNode.get_border_width(St.Side.BOTTOM);
        let indicatorLeftFullBorder = indicatorThemeNode.get_padding(St.Side.LEFT) + indicatorThemeNode.get_border_width(St.Side.LEFT);
        let indicatorRightFullBorder = indicatorThemeNode.get_padding(St.Side.RIGHT) + indicatorThemeNode.get_border_width(St.Side.RIGHT);

        let x = box.x1;

        let childBox = new Clutter.ActorBox();

        for (let i = 0; i < this._thumbnails.length; i++) {
            const thumbnail = this._thumbnails[i];
            if (i > 0)
                x += spacing;

            const y1 = box.y1;
            const y2 = y1 + thumbnailHeight;

            // We might end up with thumbnailWidth being something like 99.33
            // pixels. To make this work and not end up with a gap at the end,
            // we need some thumbnails to be 99 pixels and some 100 pixels width;
            // we compute an actual scale separately for each thumbnail.
            const x1 = Math.round(x);
            const x2 = Math.round(x + thumbnailWidth);
            const roundedHScale = (x2 - x1) / portholeWidth;

            // Allocating a scaled actor is funny - x1/y1 correspond to the origin
            // of the actor, but x2/y2 are increased by the *unscaled* size.
            if (rtl) {
                childBox.x2 = box.x2 - x1;
                childBox.x1 = box.x2 - (x1 + thumbnailWidth);
            } else {
                childBox.x1 = x1;
                childBox.x2 = x1 + thumbnailWidth;
            }
            childBox.y1 = y1;
            childBox.y2 = y1 + thumbnailHeight;

            thumbnail.setScale(roundedHScale, roundedVScale);
            thumbnail.allocate(childBox);

            if (i === indicatorUpperWs) {
                indicatorUpperX1 = childBox.x1;
                indicatorUpperX2 = childBox.x2;
            }
            if (i === indicatorLowerWs) {
                indicatorLowerX1 = childBox.x1;
                indicatorLowerX2 = childBox.x2;
            }

            x += thumbnailWidth;
        }

        childBox.y1 = box.y1;
        childBox.y2 = box.y1 + thumbnailHeight;

        const indicatorX1 = indicatorLowerX1 +
            (indicatorUpperX1 - indicatorLowerX1) * (indicatorValue % 1);
        const indicatorX2 = indicatorLowerX2 +
            (indicatorUpperX2 - indicatorLowerX2) * (indicatorValue % 1);

        childBox.x1 = indicatorX1 - indicatorLeftFullBorder;
        childBox.x2 = indicatorX2 + indicatorRightFullBorder;
        childBox.y1 -= indicatorTopFullBorder;
        childBox.y2 += indicatorBottomFullBorder;
        this._indicator.allocate(childBox);
    }
});
