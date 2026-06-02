import { Component, Inject, OnInit, OnDestroy } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Subscription } from 'rxjs';

import { HmiService } from '../../_services/hmi.service';
import { RecipeProgressEvent, RecipeCompleteEvent } from '../../_models/recipe';

/** Data passed into the progress dialog */
export interface RecipeProgressData {
    recipeId: string;
    recipeName: string;
    totalEntries: number;
    mode: 'download' | 'upload';
}

/** Internal model for per-entry visual status */
interface EntryStatus {
    entryId: string;
    tagId: string;
    tagName: string;
    status: string;
    value?: any;
    error?: string;
}

@Component({
    selector: 'app-recipe-progress',
    templateUrl: './recipe-progress.component.html',
    styleUrls: ['./recipe-progress.component.css']
})
export class RecipeProgressComponent implements OnInit, OnDestroy {

    progress = 0;
    completedCount = 0;
    isComplete = false;
    isCancelled = false;
    hasErrors = false;
    errors: { entryId: string; tagId: string; error: string }[] = [];
    entryStatuses: EntryStatus[] = [];

    private subscriptionProgress!: Subscription;
    private subscriptionComplete!: Subscription;
    private subscriptionError!: Subscription;

    constructor(
        public dialogRef: MatDialogRef<RecipeProgressComponent>,
        @Inject(MAT_DIALOG_DATA) public data: RecipeProgressData,
        private hmiService: HmiService
    ) { }

    ngOnInit() {
        this.entryStatuses = [];

        const progressEvent = this.data.mode === 'download'
            ? this.hmiService.onRecipeDownloadProgress
            : this.hmiService.onRecipeUploadProgress;

        const completeEvent = this.data.mode === 'download'
            ? this.hmiService.onRecipeDownloadComplete
            : this.hmiService.onRecipeUploadComplete;

        const errorEvent = this.data.mode === 'download'
            ? this.hmiService.onRecipeDownloadError
            : this.hmiService.onRecipeUploadError;

        this.subscriptionProgress = progressEvent.subscribe((event: RecipeProgressEvent) => {
            if (event.recipeId !== this.data.recipeId) return;

            const existing = this.entryStatuses.find(e => e.entryId === event.entryId);
            if (existing) {
                existing.status = event.status;
                existing.value = event.value;
                existing.error = event.error;
            } else {
                this.entryStatuses.push({
                    entryId: event.entryId || '',
                    tagId: event.tagId || '',
                    tagName: event.tagName || '',
                    status: event.status,
                    value: event.value,
                    error: event.error
                });
            }

            this.completedCount = this.entryStatuses.filter(e =>
                e.status === 'success' || e.status === 'error'
            ).length;
            this.progress = Math.round((this.completedCount / this.data.totalEntries) * 100);
            this.hasErrors = this.entryStatuses.some(e => e.status === 'error');
        });

        this.subscriptionComplete = completeEvent.subscribe((event: RecipeCompleteEvent) => {
            if (event.recipeId !== this.data.recipeId) return;

            this.isComplete = true;
            this.progress = 100;
            this.errors = event.errors || [];
            this.hasErrors = event.errorCount > 0;
        });

        this.subscriptionError = errorEvent.subscribe((event: any) => {
            if (event.recipeId !== this.data.recipeId) return;

            this.isComplete = true;
            this.hasErrors = true;
            this.errors = [{ entryId: '', tagId: '', error: event.error }];
        });
    }

    ngOnDestroy() {
        this._safeUnsubscribe(this.subscriptionProgress);
        this._safeUnsubscribe(this.subscriptionComplete);
        this._safeUnsubscribe(this.subscriptionError);
    }

    /** Cancel the ongoing recipe execution */
    onCancel() {
        this.isCancelled = true;
        this.hmiService.cancelRecipeExecution(this.data.recipeId);
    }

    /** Close the progress dialog */
    onClose() {
        this.dialogRef.close();
    }

    /** Return the Material icon name for a given status */
    getStatusIcon(status: string): string {
        switch (status) {
            case 'success': return 'check_circle';
            case 'error': return 'error';
            case 'writing':
            case 'reading': return 'hourglass_empty';
            default: return 'pending';
        }
    }

    /** Return the display colour for a given status */
    getStatusColor(status: string): string {
        switch (status) {
            case 'success': return '#4caf50';
            case 'error': return '#f44336';
            case 'writing':
            case 'reading': return '#ff9800';
            default: return '#9e9e9e';
        }
    }

    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------

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
}
