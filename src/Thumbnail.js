const WorkspaceThumbnail = imports.ui.workspaceThumbnail.WorkspaceThumbnail;

const { Clutter, GObject, Graphene, Meta, St } = imports.gi;

const Main = imports.ui.main;
const { TransientSignalHolder } = imports.misc.signalTracker;
const Workspace = imports.ui.workspace;

// The maximum size of a thumbnail is 5% the width and height of the screen
var MAX_THUMBNAIL_SCALE = 0.05;

const genParam = (type, name, ...dflt) => GObject.ParamSpec[type](name, name, name, GObject.ParamFlags.READWRITE, ...dflt);

var Thumbnail = class _ThumbnailsBox extends St.Widget {
    static {
        GObject.registerClass({
            Properties: {
                active:   genParam('boolean', 'active', false)
            },
        }, this);
    }

    getActive() { return this._active; }
    
    setActive(active) { 
        this._active = active; 
        this._indicator.visible = this._active; 
    }

    constructor(metaWorkspace, porthole, monitorIndex) {
        super({
            style_class: 'cheese-workspace-thumbnail',
            layout_manager: new Clutter.BinLayout(),
            width: porthole.width * MAX_THUMBNAIL_SCALE,
            height: porthole.height * MAX_THUMBNAIL_SCALE,
            reactive: true,
            content_gravity: Clutter.ContentGravity.RESIZE_ASPECT
        });

        this._metaWorkspace = metaWorkspace;
        this._porthole = porthole;
        this._monitorIndex = monitorIndex;

        this._thumbnail = new WorkspaceThumbnail(this._metaWorkspace, this._monitorIndex);
        this._thumbnail.setPorthole(
            this._porthole.x, this._porthole.y,
            this._porthole.width, this._porthole.height
        );
        this.add_actor(this._thumbnail);

        let indicator = new St.Bin({ style_class: 'workspace-thumbnail-indicator' });
        this._indicator = indicator;
        this.add_actor(indicator);

        this.setActive(false);
    }

    _onDestroy() {
        this._indicator.destroy();
        this._indicator = null;

        this._thumbnail.destroy();
        this._thumbnail = null;

        this._metaWorkspace = null;
        this._porthole = null;
    }

    activate(time) {
        this._metaWorkspace.activate(time || global.get_current_time());
    }

    vfunc_button_release_event(buttonEvent) {
        this.activate(buttonEvent.time);
        return Clutter.EVENT_STOP;
    }

    vfunc_touch_event(touchEvent) {
        if (touchEvent.type == Clutter.EventType.TOUCH_END &&
            global.display.is_pointer_emulating_sequence(touchEvent.sequence)) {
            this._activate(touchEvent.time);
        }

        return Clutter.EVENT_STOP;
    }

    syncStacking(stackIndices) {
        this._thumbnail.syncStacking(stackIndices);
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        let themeNode = this.get_theme_node();
        box = themeNode.get_content_box(box);

        const portholeWidth = this._porthole.width;
        const portholeHeight = this._porthole.height;

        const hScale = box.get_width() / portholeWidth;
        const vScale = box.get_height() / portholeHeight;
        const scale = Math.min(hScale, vScale);

        this._indicator.allocate(box);
        this._thumbnail.allocate(box);
        this._thumbnail.setScale(scale, scale);
    }
}
