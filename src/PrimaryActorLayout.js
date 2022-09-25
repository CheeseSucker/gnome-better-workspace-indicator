const { Clutter, GObject } = imports.gi;

/* A layout manager that requests size only for primary_actor, but then allocates
   all using a fixed layout */
   var PrimaryActorLayout = GObject.registerClass(
    class PrimaryActorLayout extends Clutter.FixedLayout {
        _init(primaryActor) {
            super._init();
    
            this.primaryActor = primaryActor;
        }
    
        vfunc_get_preferred_width(container, forHeight) {
            return this.primaryActor.get_preferred_width(forHeight);
        }
    
        vfunc_get_preferred_height(container, forWidth) {
            return this.primaryActor.get_preferred_height(forWidth);
        }
    });
