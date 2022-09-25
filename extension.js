/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const ThumbnailsBox = imports.misc.extensionUtils.getCurrentExtension().imports.src.ThumbnailsBox.ThumbnailsBox


const { GObject, St, Clutter } = imports.gi;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

let Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Workspace Preview'));

        this._thumbnailsBox = new ThumbnailsBox(Main.layoutManager.primaryIndex);
        this.add_actor(this._thumbnailsBox);
    }
});

class Extension {
    constructor(uuid) {
        this._uuid = uuid;
    }

    enable() {
        this._indicator =  new Indicator();
        Main.panel.addToStatusArea(this._uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}

function init(meta) {
    return new Extension(meta.uuid);
}
