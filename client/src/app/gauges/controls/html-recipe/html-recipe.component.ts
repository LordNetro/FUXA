import { Component, ViewContainerRef, ComponentFactoryResolver, ComponentRef, OnInit, OnDestroy } from '@angular/core';
import { MatDialog as MatDialog } from '@angular/material/dialog';
import { GaugeBaseComponent } from '../../gauge-base/gauge-base.component';
import { GaugeSettings, Variable, GaugeStatus } from '../../../_models/hmi';
import { Utils } from '../../../_helpers/utils';
import { GaugeDialogType } from '../../gauge-property/gauge-property.component';
import { RecipeService } from '../../../_services/recipe.service';
import { HmiService } from '../../../_services/hmi.service';
import { Recipe, RecipeEntry, RecipeProgressEvent, RecipeCompleteEvent } from '../../../_models/recipe';
import { Subscription } from 'rxjs';
import { HtmlRecipeNewDialogComponent } from './html-recipe-new-dialog/html-recipe-new-dialog.component';

/**
 * Runtime view component for the HTML recipe widget.
 * Displays a recipe selector, editable entries table, and action buttons
 * for save / download (push) / upload (pull).
 */
@Component({
    selector: 'html-recipe-view',
    templateUrl: './html-recipe.component.html',
    styleUrls: ['./html-recipe.component.css']
})
export class HtmlRecipeViewComponent implements OnInit, OnDestroy {

    /** All available recipes for the selector dropdown */
    allRecipes: { id: string; data: Recipe }[] = [];

    /** Currently selected recipe id */
    selectedRecipeId: string = '';

    /** Currently selected recipe metadata (name / description) */
    selectedRecipe: Recipe | null = null;

    /** Editable copy of the selected recipe's entries */
    entries: RecipeEntry[] = [];

    loading = true;
    error: string = '';
    saving = false;
    downloading = false;
    uploading = false;
    readonly = false;

    /** Progress state during download / upload execution */
    progress: { current: number; total: number; errors: string[] } | null = null;

    /** Gauge colour properties bound from the designer */
    backgroundColor: string = '#f0f0f0';
    textColor: string = '#505050';
    borderColor: string = '#cccccc';
    accentColor: string = '#2196f3';
    borderWidth: number = 1;

    /** Default recipe id to pre-select (set from designer property) */
    private defaultRecipeId!: string;

    /** Tracks the current execution direction for progress filtering */
    private progressMode: 'download' | 'upload' | null = null;

    private subscriptionDownloadProgress!: Subscription;
    private subscriptionDownloadComplete!: Subscription;
    private subscriptionDownloadError!: Subscription;
    private subscriptionUploadProgress!: Subscription;
    private subscriptionUploadComplete!: Subscription;
    private subscriptionUploadError!: Subscription;

    constructor(private recipeService: RecipeService, private hmiService: HmiService, private dialog: MatDialog) { }

    ngOnInit() {
        this.loadAllRecipes();
        this._subscribeToProgressEvents();
    }

    ngOnDestroy() {
        this._unsubscribeProgress();
    }

    /** Subscribe to download and upload Socket.IO progress events */
    private _subscribeToProgressEvents() {
        this.subscriptionDownloadProgress = this.hmiService.onRecipeDownloadProgress
            .subscribe((event: RecipeProgressEvent) => {
                if (this.progressMode !== 'download') return;
                this.progress = { current: event.index + 1, total: event.total, errors: [] };
            });

        this.subscriptionDownloadComplete = this.hmiService.onRecipeDownloadComplete
            .subscribe((event: RecipeCompleteEvent) => {
                if (this.progressMode !== 'download') return;
                this.downloading = false;
                this.progressMode = null;
                this.progress = null;
                if (event.errorCount > 0) {
                    this.error = `Download completed with ${event.errorCount} error(s)`;
                }
            });

        this.subscriptionDownloadError = this.hmiService.onRecipeDownloadError
            .subscribe((event: any) => {
                if (this.progressMode !== 'download') return;
                this.downloading = false;
                this.progressMode = null;
                this.progress = null;
                this.error = event.error || 'Download failed';
            });

        this.subscriptionUploadProgress = this.hmiService.onRecipeUploadProgress
            .subscribe((event: RecipeProgressEvent) => {
                if (this.progressMode !== 'upload') return;
                this.progress = { current: event.index + 1, total: event.total, errors: [] };
            });

        this.subscriptionUploadComplete = this.hmiService.onRecipeUploadComplete
            .subscribe((event: RecipeCompleteEvent) => {
                if (this.progressMode !== 'upload') return;
                this.uploading = false;
                this.progressMode = null;
                this.progress = null;
                if (event.errorCount > 0) {
                    this.error = `Upload completed with ${event.errorCount} error(s)`;
                }
                setTimeout(() => this.loadAllRecipes(), 1000);
            });

        this.subscriptionUploadError = this.hmiService.onRecipeUploadError
            .subscribe((event: any) => {
                if (this.progressMode !== 'upload') return;
                this.uploading = false;
                this.progressMode = null;
                this.progress = null;
                this.error = event.error || 'Upload failed';
            });
    }

    /** Tear down all progress subscriptions */
    private _unsubscribeProgress() {
        this._safeUnsubscribe(this.subscriptionDownloadProgress);
        this._safeUnsubscribe(this.subscriptionDownloadComplete);
        this._safeUnsubscribe(this.subscriptionDownloadError);
        this._safeUnsubscribe(this.subscriptionUploadProgress);
        this._safeUnsubscribe(this.subscriptionUploadComplete);
        this._safeUnsubscribe(this.subscriptionUploadError);
    }

    /** Safely unsubscribe from an RxJS subscription */
    private _safeUnsubscribe(sub: Subscription | undefined): void {
        try {
            if (sub) {
                sub.unsubscribe();
            }
        } catch (_e) {
            // Ignore unsubscribe errors during teardown
        }
    }

    /**
     * Load all available recipes from the server and pre-select the
     * default recipe (if set) or the first available one.
     */
    loadAllRecipes() {
        this.loading = true;
        this.error = '';
        this.recipeService.getRecipes().subscribe({
            next: (result) => {
                this.allRecipes = result.recipes || [];
                this.loading = false;

                const stillExists = this.selectedRecipeId && this.allRecipes.some(r => r.id === this.selectedRecipeId);
                if (!stillExists) {
                    if (this.defaultRecipeId && this.allRecipes.some(r => r.id === this.defaultRecipeId)) {
                        this.selectedRecipeId = this.defaultRecipeId;
                    } else if (this.allRecipes.length > 0) {
                        this.selectedRecipeId = this.allRecipes[0].id;
                    } else {
                        this.selectedRecipeId = '';
                    }
                }

                if (this.selectedRecipeId) {
                    this._loadSelectedRecipe();
                }
            },
            error: () => {
                this.error = 'Failed to load recipes';
                this.loading = false;
            }
        });
    }

    /** React to user selecting a different recipe from the dropdown */
    onSelectRecipe() {
        this._loadSelectedRecipe();
    }

    /** Load the currently selected recipe's details into the editable entries array */
    private _loadSelectedRecipe() {
        if (!this.selectedRecipeId) return;

        const found = this.allRecipes.find(r => r.id === this.selectedRecipeId);
        if (found) {
            this.selectedRecipe = found.data;
            this.entries = (found.data.entries || []).map(e => ({ ...e }));
            this.error = '';
        } else {
            this.selectedRecipe = null;
            this.entries = [];
        }
    }

    /** Sanitize entries: coerce null/undefined to defaults per tagType */
    private _sanitizeEntries(entries: RecipeEntry[]): RecipeEntry[] {
        return entries.map(e => {
            if (e.value === null || e.value === undefined) {
                const t = (e.tagType || '').toLowerCase();
                if (['bool', 'boolean'].includes(t)) {
                    e.value = false;
                } else if (['int', 'dint', 'int16', 'int32', 'number', 'real', 'float', 'double', 'byte'].includes(t)) {
                    e.value = 0;
                } else {
                    e.value = '';
                }
            }
            return e;
        });
    }

    /** Save the current entries to the server */
    onSave() {
        if (!this.selectedRecipeId || !this.selectedRecipe) return;

        this.saving = true;
        this.error = '';
        this._sanitizeEntries(this.entries);

        const recipe = {
            id: this.selectedRecipeId,
            name: this.selectedRecipe.name,
            description: this.selectedRecipe.description,
            entries: this.entries
        };

        this.recipeService.saveRecipe(recipe).subscribe({
            next: () => {
                this.saving = false;
                this.loadAllRecipes();
            },
            error: (err) => {
                this.error = err?.error?.error || 'Save failed';
                this.saving = false;
            }
        });
    }

    /**
     * Download (push) the current recipe values to the PLC.
     * Saves edited values first, then triggers the async download.
     */
    onDownload() {
        if (this.downloading || this.saving || !this.selectedRecipeId || !this.selectedRecipe) return;

        this.error = '';
        this._sanitizeEntries(this.entries);

        const recipe = {
            id: this.selectedRecipeId,
            name: this.selectedRecipe.name,
            description: this.selectedRecipe.description,
            entries: this.entries
        };

        this.saving = true;
        this.recipeService.saveRecipe(recipe).subscribe({
            next: () => {
                this.saving = false;
                this.recipeService.downloadRecipe(this.selectedRecipeId).subscribe({
                    next: (result) => {
                        this.progressMode = 'download';
                        this.downloading = true;
                        this.progress = { current: 0, total: result.totalEntries || this.entries.length, errors: [] };
                    },
                    error: (err) => {
                        this.downloading = false;
                        this.progress = null;
                        this.error = err?.error?.error || 'Download failed';
                    }
                });
            },
            error: (err) => {
                this.error = err?.error?.error || 'Save before download failed';
                this.saving = false;
            }
        });
    }

    /**
     * Upload (pull) current PLC values into the recipe and refresh
     * the displayed entries afterwards.
     */
    onUpload() {
        if (this.uploading || !this.selectedRecipeId) return;

        this.error = '';
        this.recipeService.uploadRecipe(this.selectedRecipeId).subscribe({
            next: (result) => {
                this.progressMode = 'upload';
                this.uploading = true;
                this.progress = { current: 0, total: result.totalEntries || this.entries.length, errors: [] };
            },
            error: (err) => {
                this.uploading = false;
                this.progress = null;
                this.error = err?.error?.error || 'Upload failed';
            }
        });
    }

    /**
     * Open a dialog to create a new recipe.
     * The operator sets name and description (pre-filled with "New Recipe").
     * On save, clones the current recipe's entries with sanitized defaults.
     */
    onNewRecipe() {
        if (!this.selectedRecipe || !this.selectedRecipeId) return;

        const sourceEntries = this.selectedRecipe.entries.map(e => ({ ...e }));

        const dialogRef = this.dialog.open(HtmlRecipeNewDialogComponent, {
            data: { name: 'New Recipe', description: 'New Recipe' },
            disableClose: true
        });

        dialogRef.afterClosed().subscribe(result => {
            if (!result) return;

            this.saving = true;
            this.error = '';

            const entries = this._sanitizeEntries(sourceEntries);

            this.recipeService.saveRecipe({
                name: result.name.trim(),
                description: result.description.trim(),
                entries
            }).subscribe({
                next: (saveResult) => {
                    this.saving = false;
                    this.loadAllRecipes();
                    if (saveResult?.id) {
                        this.selectedRecipeId = saveResult.id;
                    }
                },
                error: (err) => {
                    this.error = err?.error?.error || 'Failed to create recipe';
                    this.saving = false;
                }
            });
        });
    }

    /** Set the default recipe id (called from initElement with the designer property) */
    setDefaultRecipeId(id: string) {
        this.defaultRecipeId = id;
        if (this.allRecipes.length > 0 && id) {
            if (this.allRecipes.some(r => r.id === id)) {
                this.selectedRecipeId = id;
                this._loadSelectedRecipe();
            }
        }
    }

    /** Configure the read-only mode for the widget */
    setReadonly(readonly: boolean) {
        this.readonly = readonly;
    }

    /** Return the badge colour for a given tag type */
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

    /** Apply designer colours to the widget */
    setColors(colors: { background?: string; text?: string; border?: string; accent?: string }) {
        if (colors) {
            this.backgroundColor = colors.background || this.backgroundColor;
            this.textColor = colors.text || this.textColor;
            this.borderColor = colors.border || this.borderColor;
            this.accentColor = colors.accent || this.accentColor;
        }
    }
}

/**
 * Static gauge component registration for the recipe widget.
 * This is the factory class that the gauge system uses to instantiate
 * HtmlRecipeViewComponent inside SVG editor canvases.
 */
@Component({
    template: ''
})
export class HtmlRecipeComponent extends GaugeBaseComponent {
    static TypeTag = 'svg-ext-own_ctrl-recipe';
    static LabelTag = 'HtmlRecipe';
    static prefixD = 'D-OXC_';

    constructor() {
        super();
    }

    static getDialogType(): GaugeDialogType {
        return GaugeDialogType.Recipe;
    }

    static getSignals(pro: any) {
        return [];
    }

    /** Initialise the recipe widget inside the SVG editor canvas */
    static initElement(
        gab: GaugeSettings,
        resolver: ComponentFactoryResolver,
        viewContainerRef: ViewContainerRef,
        isview: boolean
    ): HtmlRecipeViewComponent | null {
        const ele = document.getElementById(gab.id);
        if (!ele) return null;

        ele?.setAttribute('data-name', gab.name);

        const rect = ele.querySelector('rect');
        if (rect && !rect.hasAttribute('data-initialized')) {
            if (!rect.getAttribute('fill') ||
                rect.getAttribute('fill') === '#FFFFFF' ||
                rect.getAttribute('fill') === 'rgb(255, 255, 255)') {
                rect.setAttribute('fill', '#f9f9f9ff');
            }
            rect.setAttribute('data-initialized', 'true');
        }

        const htmlRecipe = Utils.searchTreeStartWith(ele, this.prefixD);
        if (!htmlRecipe) return null;

        const factory = resolver.resolveComponentFactory(HtmlRecipeViewComponent);
        const componentRef: ComponentRef<HtmlRecipeViewComponent> = viewContainerRef.createComponent(factory);

        if (!gab.property) {
            gab.property = { recipeId: null, readonly: false };
        }

        gab.property.backgroundColor ??= '#f0f0f0';
        gab.property.textColor ??= '#505050';
        gab.property.borderColor ??= '#cccccc';
        gab.property.accentColor ??= '#2196f3';

        htmlRecipe.innerHTML = '';
        componentRef.instance.setDefaultRecipeId(gab.property.recipeId);
        componentRef.instance.setReadonly(gab.property.readonly);
        componentRef.instance.setColors({
            background: gab.property.backgroundColor,
            text: gab.property.textColor,
            border: gab.property.borderColor,
            accent: gab.property.accentColor
        });

        componentRef.changeDetectorRef.detectChanges();
        htmlRecipe.appendChild(componentRef.location.nativeElement);

        (componentRef.instance as any)['myComRef'] = componentRef;
        (componentRef.instance as any)['name'] = gab.name;
        return componentRef.instance;
    }

    static detectChange(ga: GaugeSettings, res: any, ref: any) {
        return HtmlRecipeComponent.initElement(ga, res, ref, false);
    }
}
