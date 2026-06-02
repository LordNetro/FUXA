import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatTable, MatTableDataSource } from '@angular/material/table';
import { MatSort } from '@angular/material/sort';
import { Subscription } from 'rxjs';

import { TranslateService } from '@ngx-translate/core';
import { RecipeService } from '../../_services/recipe.service';
import { RecipeEditorComponent } from '../recipe-editor/recipe-editor.component';
import { RecipeProgressComponent } from '../recipe-progress/recipe-progress.component';
import { Recipe, RecipeEntry } from '../../_models/recipe';
import { Utils } from '../../_helpers/utils';
import { HmiService } from '../../_services/hmi.service';
import { ToastrService } from 'ngx-toastr';

/** Row model displayed in the recipe list table */
interface RecipeListItem {
    id: string;
    name: string;
    description: string;
    entries: number;
    updatedAt: string;
    data: Recipe;
}

@Component({
    selector: 'app-recipe-list',
    templateUrl: './recipe-list.component.html',
    styleUrls: ['./recipe-list.component.css']
})
export class RecipeListComponent implements OnInit, AfterViewInit, OnDestroy {

    displayedColumns = ['name', 'description', 'entries', 'updatedAt', 'actions'];
    dataSource = new MatTableDataSource<RecipeListItem>([]);

    private subscriptionLoad!: Subscription;
    private subscriptionDownloadComplete!: Subscription;
    private subscriptionUploadComplete!: Subscription;

    @ViewChild(MatTable, { static: false }) table: MatTable<any>;
    @ViewChild(MatSort, { static: false }) sort: MatSort;

    constructor(
        public dialog: MatDialog,
        private translateService: TranslateService,
        private recipeService: RecipeService,
        private hmiService: HmiService,
        private toastr: ToastrService
    ) { }

    ngOnInit() {
        this.loadRecipes();
    }

    ngAfterViewInit() {
        this.dataSource.sort = this.sort;
    }

    ngOnDestroy() {
        this._safeUnsubscribe(this.subscriptionLoad);
        this._safeUnsubscribe(this.subscriptionDownloadComplete);
        this._safeUnsubscribe(this.subscriptionUploadComplete);
    }

    /** Reload the recipe list from the server */
    loadRecipes() {
        this.subscriptionLoad = this.recipeService.getRecipes().subscribe({
            next: (result) => {
                const items: RecipeListItem[] = (result.recipes || []).map(r => ({
                    id: r.id,
                    name: r.data?.name || '',
                    description: r.data?.description || '',
                    entries: r.data?.entries?.length || 0,
                    updatedAt: r.data?.updatedAt || '',
                    data: r.data
                }));
                this.dataSource.data = items;
            },
            error: (err) => {
                console.error('Failed to load recipes:', err);
            }
        });
    }

    /** Open the editor dialog to create a new recipe */
    onAddRecipe() {
        const dialogRef = this.dialog.open(RecipeEditorComponent, {
            disableClose: true,
            position: { top: '60px' },
            width: '800px',
            data: { recipe: null, newRecipe: true }
        });

        dialogRef.afterClosed().subscribe(result => {
            if (result) {
                this.loadRecipes();
            }
        });
    }

    /** Open the editor dialog to edit an existing recipe */
    onEditRecipe(item: RecipeListItem) {
        const dialogRef = this.dialog.open(RecipeEditorComponent, {
            disableClose: true,
            position: { top: '60px' },
            width: '800px',
            data: { recipe: { id: item.id, ...item.data }, newRecipe: false }
        });

        dialogRef.afterClosed().subscribe(result => {
            if (result) {
                this.loadRecipes();
            }
        });
    }

    /** Delete a recipe after user confirmation */
    onDeleteRecipe(item: RecipeListItem) {
        const confirmMsg = this.translateService.instant('recipes.delete-confirm', { name: item.name });
        if (confirm(confirmMsg || `Delete recipe "${item.name}"?`)) {
            this.recipeService.deleteRecipe(item.id).subscribe({
                next: () => {
                    this.loadRecipes();
                    this.toastr.success(this.translateService.instant('recipes.delete-success'));
                },
                error: (err) => {
                    this.toastr.error(err?.error?.error || 'Delete failed');
                }
            });
        }
    }

    /** Start async download (push recipe values to device tags) and reload list on completion */
    onDownloadRecipe(item: RecipeListItem) {
        this.recipeService.downloadRecipe(item.id).subscribe({
            next: (result) => {
                const dialogRef = this.dialog.open(RecipeProgressComponent, {
                    disableClose: true,
                    width: '600px',
                    data: {
                        recipeId: result.recipeId,
                        recipeName: item.name,
                        totalEntries: result.totalEntries,
                        mode: 'download'
                    }
                });
                dialogRef.afterClosed().subscribe(() => this.loadRecipes());
            },
            error: (err) => {
                this.toastr.error(err?.error?.error || 'Download failed');
            }
        });
    }

    /** Start async upload (pull device values into recipe) and reload list on completion */
    onUploadRecipe(item: RecipeListItem) {
        this.recipeService.uploadRecipe(item.id).subscribe({
            next: (result) => {
                const dialogRef = this.dialog.open(RecipeProgressComponent, {
                    disableClose: true,
                    width: '600px',
                    data: {
                        recipeId: result.recipeId,
                        recipeName: item.name,
                        totalEntries: result.totalEntries,
                        mode: 'upload'
                    }
                });
                dialogRef.afterClosed().subscribe(() => this.loadRecipes());
            },
            error: (err) => {
                this.toastr.error(err?.error?.error || 'Upload failed');
            }
        });
    }

    /** Export a recipe as JSON or CSV file (triggers browser download) */
    onExportRecipe(item: RecipeListItem, format: 'json' | 'csv') {
        this.recipeService.exportRecipe(item.id, format).subscribe({
            next: (blob) => {
                const ext = format === 'json' ? 'json' : 'csv';
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${item.name}.${ext}`;
                a.click();
                window.URL.revokeObjectURL(url);
                this.toastr.success(this.translateService.instant('recipes.export-success'));
            },
            error: (err) => {
                this.toastr.error(err?.error?.error || 'Export failed');
            }
        });
    }

    /** Import a recipe from a local JSON/CSV file */
    onImportRecipe(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            const file = input.files[0];
            const reader = new FileReader();
            reader.onload = () => {
                const content = reader.result as string;
                const format = file.name.endsWith('.csv') ? 'csv' : 'json';
                const name = file.name.replace(/\.(json|csv)$/, '');

                this.recipeService.importRecipe({ file: content, format, name }).subscribe({
                    next: (result) => {
                        this.loadRecipes();
                        this.toastr.success(
                            this.translateService.instant('recipes.import-success', { name: result.name, count: result.entriesCount })
                        );
                    },
                    error: (err) => {
                        this.toastr.error(err?.error?.error || 'Import failed');
                    }
                });
            };
            reader.readAsText(file);
            input.value = '';
        }
    }

    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------

    /** Safely unsubscribe from an RxJS subscription if it exists */
    private _safeUnsubscribe(sub: Subscription | undefined): void {
        try {
            if (sub) {
                sub.unsubscribe();
            }
        } catch (_e) {
            // Ignore unsubscribe errors during teardown
        }
    }
}
