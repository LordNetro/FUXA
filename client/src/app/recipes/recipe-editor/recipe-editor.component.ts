import { Component, Inject, OnInit, ViewChild } from '@angular/core';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatTable, MatTableDataSource } from '@angular/material/table';

import { RecipeService } from '../../_services/recipe.service';
import { TagBrowserComponent, TagBrowserData } from '../tag-browser/tag-browser.component';
import { Recipe, RecipeEntry } from '../../_models/recipe';
import { Utils } from '../../_helpers/utils';
import { ToastrService } from 'ngx-toastr';

/** Data passed into the editor dialog */
export interface RecipeEditorData {
    recipe?: { id: string; name: string; description: string; entries: RecipeEntry[] };
    newRecipe?: boolean;
}

@Component({
    selector: 'app-recipe-editor',
    templateUrl: './recipe-editor.component.html',
    styleUrls: ['./recipe-editor.component.css']
})
export class RecipeEditorComponent implements OnInit {

    displayedColumns = ['tagId', 'tagName', 'tagType', 'value', 'actions'];
    dataSource = new MatTableDataSource<RecipeEntry>([]);

    name = '';
    description = '';
    recipeId: string | null = null;

    @ViewChild(MatTable, { static: false }) table!: MatTable<any>;

    constructor(
        public dialog: MatDialog,
        public dialogRef: MatDialogRef<RecipeEditorComponent>,
        @Inject(MAT_DIALOG_DATA) public data: RecipeEditorData,
        private recipeService: RecipeService,
        private toastr: ToastrService
    ) { }

    ngOnInit() {
        if (this.data.recipe) {
            this.recipeId = this.data.recipe.id;
            this.name = this.data.recipe.name || '';
            this.description = this.data.recipe.description || '';
            this.dataSource.data = this.data.recipe.entries || [];
        } else {
            this.recipeId = null;
        }
    }

    /** Open the tag browser dialog to add a new entry */
    onAddEntry() {
        const dialogRef = this.dialog.open(TagBrowserComponent, {
            disableClose: true,
            width: '600px',
            data: {} as TagBrowserData
        });

        dialogRef.afterClosed().subscribe(result => {
            if (result) {
                const entry: RecipeEntry = {
                    id: 'e_' + Utils.getGUID(''),
                    tagId: result.tagId,
                    tagName: result.tagName,
                    tagType: result.tagType,
                    value: ''
                };
                this.dataSource.data = [...this.dataSource.data, entry];
                this.table?.renderRows();
            }
        });
    }

    /** Remove an entry from the recipe */
    onRemoveEntry(entry: RecipeEntry) {
        this.dataSource.data = this.dataSource.data.filter(e => e.id !== entry.id);
        this.table?.renderRows();
    }

    /** Validate and persist the recipe to the server */
    onSave() {
        if (!this.name.trim()) {
            this.toastr.error('Name is required');
            return;
        }

        if (this.dataSource.data.length === 0) {
            this.toastr.error('Recipe must have at least one entry');
            return;
        }

        const recipe = {
            id: this.recipeId || undefined,
            name: this.name.trim(),
            description: this.description.trim(),
            entries: this.dataSource.data
        };

        this.recipeService.saveRecipe(recipe).subscribe({
            next: (result) => {
                this.dialogRef.close(result);
            },
            error: (err) => {
                this.toastr.error(err?.error?.error || 'Save failed');
            }
        });
    }

    /** Close the dialog without saving */
    onCancel() {
        this.dialogRef.close();
    }

    /** Return a colour for the tag type badge */
    getTagTypeColor(tagType: string): string {
        switch (tagType?.toLowerCase()) {
            case 'boolean':
            case 'bool': return '#4caf50';
            case 'number':
            case 'int':
            case 'dint':
            case 'real':
            case 'float': return '#2196f3';
            default: return '#ff9800';
        }
    }

    /** Check whether a tag type belongs to the numeric family */
    isNumericType(tagType: string): boolean {
        const t = (tagType || '').toLowerCase();
        return ['number', 'int', 'dint', 'int16', 'int32', 'real', 'float', 'double', 'byte'].includes(t);
    }

    /** Check whether a tag type belongs to the string family */
    isStringType(tagType: string): boolean {
        const t = (tagType || '').toLowerCase();
        return ['string', 'word'].includes(t);
    }
}
