import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { RecipeService } from '../../../../_services/recipe.service';
import { Recipe } from '../../../../_models/recipe';

/**
 * Property panel for the HTML recipe widget used inside the SVG editor.
 * Allows the designer to select a default recipe, toggle read-only mode,
 * and configure colours.
 */
@Component({
    selector: 'app-recipe-property',
    templateUrl: './recipe-property.component.html',
    styleUrls: ['./recipe-property.component.scss']
})
export class RecipePropertyComponent implements OnInit {
    @Input() data: any;
    @Output() onPropChanged = new EventEmitter<any>();
    @Input('reload') set reload(b: any) {
        this._reload();
    }

    recipes: { id: string; data: Recipe }[] = [];
    property: any = {};
    loading = false;

    constructor(private recipeService: RecipeService) { }

    ngOnInit(): void {
        this._reload();
    }

    private _reload() {
        this.loadRecipes();
        if (!this.data.settings.name) {
            this.data.settings.name = 'recipe_1';
        }
        this.property = this.data.settings.property || {};
        this.property.backgroundColor ??= '#f0f0f0';
        this.property.textColor ??= '#505050';
        this.property.borderColor ??= '#cccccc';
        this.property.accentColor ??= '#2196f3';
        this.property.readonly ??= false;
    }

    private loadRecipes() {
        this.loading = true;
        this.recipeService.getRecipes().subscribe({
            next: (result) => {
                this.recipes = result.recipes || [];
                this.loading = false;
            },
            error: (err) => {
                console.error('Failed to load recipes:', err);
                this.recipes = [];
                this.loading = false;
            }
        });
    }

    onPropertyChanged(): void {
        this.data.settings.property = this.property;
        this.onPropChanged.emit(this.data.settings);
    }
}
