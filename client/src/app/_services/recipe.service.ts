import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { EndPointApi } from '../_helpers/endpointapi';
import { Recipe, RecipeEntry, RecipeProgressEvent, RecipeCompleteEvent } from '../_models/recipe';
import { HmiService } from './hmi.service';

@Injectable({
    providedIn: 'root'
})
export class RecipeService {

    private endPointConfig: string = EndPointApi.getURL();

    constructor(private http: HttpClient, private hmiService: HmiService) { }

    /** Fetch all recipes from the server */
    getRecipes(): Observable<{ recipes: { id: string; data: Recipe }[] }> {
        return this.http.get<{ recipes: { id: string; data: Recipe }[] }>(`${this.endPointConfig}/api/recipes`);
    }

    /** Fetch a single recipe by id */
    getRecipe(id: string): Observable<Recipe> {
        return this.http.get<Recipe>(`${this.endPointConfig}/api/recipes?id=${id}`);
    }

    /** Create or update a recipe (upsert) */
    saveRecipe(recipe: { id?: string; name: string; description?: string; entries: RecipeEntry[] }): Observable<{ id: string }> {
        return this.http.post<{ id: string }>(`${this.endPointConfig}/api/recipes`, recipe);
    }

    /** Delete a recipe by id */
    deleteRecipe(id: string): Observable<{ result: string; deleted: number }> {
        return this.http.delete<{ result: string; deleted: number }>(`${this.endPointConfig}/api/recipes?id=${id}`);
    }

    /** Start async download (push recipe values to device tags) */
    downloadRecipe(id: string): Observable<{ result: string; recipeId: string; totalEntries: number }> {
        return this.http.post<{ result: string; recipeId: string; totalEntries: number }>(
            `${this.endPointConfig}/api/recipes/download`, { id }
        );
    }

    /** Start async upload (pull current device values into recipe) */
    uploadRecipe(id: string): Observable<{ result: string; recipeId: string; totalEntries: number }> {
        return this.http.post<{ result: string; recipeId: string; totalEntries: number }>(
            `${this.endPointConfig}/api/recipes/upload`, { id }
        );
    }

    /** Export a recipe as JSON or CSV (returns a Blob for download) */
    exportRecipe(id: string, format: 'json' | 'csv'): Observable<Blob> {
        return this.http.post(`${this.endPointConfig}/api/recipes/export`, { id, format }, { responseType: 'blob' });
    }

    /** Import a recipe from a JSON or CSV payload */
    importRecipe(data: { file: string; format?: string; name?: string; description?: string }): Observable<{ id: string; name: string; entriesCount: number }> {
        return this.http.post<{ id: string; name: string; entriesCount: number }>(
            `${this.endPointConfig}/api/recipes/import`, data
        );
    }

    /**
     * Placeholder to ensure recipe Socket.IO subscriptions are initialized.
     * Actual event handling lives in the UI components via hmiService observables.
     */
    subscribeToRecipeEvents(): void {
        // Events flow through hmiService.onRecipe* observables;
        // derived components subscribe directly to those.
    }
}
