/** A named collection of tag-value pairs that can be pushed to or pulled from devices */
export interface Recipe {
    id: string;
    name: string;
    description: string;
    entries: RecipeEntry[];
    createdAt?: string;
    updatedAt?: string;
}

/** A single tag-value pair inside a recipe */
export interface RecipeEntry {
    id: string;
    tagId: string;
    tagName: string;
    tagType: string;
    value: any;
}

/** Per-entry progress event emitted via Socket.IO during download/upload */
export interface RecipeProgressEvent {
    recipeId: string;
    entryId?: string;
    tagId?: string;
    tagName?: string;
    index: number;
    total: number;
    status: 'pending' | 'writing' | 'reading' | 'success' | 'error' | 'skipped';
    value?: any;
    error?: string;
}

/** Final result event when a recipe download/upload completes */
export interface RecipeCompleteEvent {
    recipeId: string;
    successCount: number;
    errorCount: number;
    errors: {
        entryId: string;
        tagId: string;
        error: string;
    }[];
}

/** Event emitted when a recipe execution is cancelled */
export interface RecipeCancelledEvent {
    recipeId: string;
    completedCount: number;
}
