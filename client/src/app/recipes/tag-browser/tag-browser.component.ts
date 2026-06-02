import { Component, Inject, OnInit } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ProjectService } from '../../_services/project.service';
import { Device, Tag } from '../../_models/device';

/** Data passed into the tag browser dialog */
export interface TagBrowserData {
    selected?: { tagId: string; tagName: string; tagType: string };
}

@Component({
    selector: 'app-tag-browser',
    templateUrl: './tag-browser.component.html',
    styleUrls: ['./tag-browser.component.css']
})
export class TagBrowserComponent implements OnInit {

    devices: Device[] = [];
    selectedDevice: Device | null = null;
    filterText = '';

    constructor(
        public dialogRef: MatDialogRef<TagBrowserComponent>,
        @Inject(MAT_DIALOG_DATA) public data: TagBrowserData,
        private projectService: ProjectService
    ) { }

    ngOnInit() {
        this.devices = Object.values(this.projectService.getDevices()) || [];
    }

    /** Select a device to browse its tags */
    onDeviceSelect(device: Device) {
        this.selectedDevice = device;
    }

    /** Select a tag and close the dialog with the chosen tag data */
    onTagSelect(tag: Tag) {
        this.dialogRef.close({
            tagId: tag.id,
            tagName: tag.name,
            tagType: tag.type || 'number'
        });
    }

    /** Return tags filtered by the user's filter text */
    getFilteredTags(): Tag[] {
        if (!this.selectedDevice || !this.selectedDevice.tags) {
            return [];
        }
        const tags = Object.values(this.selectedDevice.tags) as Tag[];
        if (!this.filterText) {
            return tags;
        }
        const filter = this.filterText.toLowerCase();
        return tags.filter(t =>
            (t.name && t.name.toLowerCase().includes(filter)) ||
            (t.id && t.id.toLowerCase().includes(filter))
        );
    }

    /** Close the dialog without selecting */
    onCancel() {
        this.dialogRef.close();
    }
}
