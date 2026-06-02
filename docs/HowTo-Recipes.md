# Recipes

A **recipe** is a named collection of tag-value pairs that can be pushed to
devices (download) or pulled from devices (upload) in a single operation.
This is commonly used in industrial automation for:

- **Batch changeover** — load a new product recipe into a PLC with one click.
- **Machine setup** — save the current machine parameters from the PLC back
  into a recipe for replication.
- **Backup / restore** — export a recipe as JSON or CSV for documentation or
  offline editing.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Client (Angular)                      │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ RecipeList   │  │ RecipeEditor │  │ HtmlRecipeWidget   │ │
│  │ Component    │  │ Component    │  │ (gauge)            │ │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘ │
│         │                 │                    │            │
│         └─────────────────┼────────────────────┘            │
│                           │                                 │
│                    ┌──────┴──────┐                          │
│                    │ RecipeService  │                        │
│                    └──────┬──────┘                          │
│                           │ HTTP REST                       │
└───────────────────────────┼─────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────┐
│                    Server (Node.js)                          │
│                           │                                  │
│                    ┌──────┴──────┐                           │
│                    │ API Routes  │                           │
│                    │ /api/recipes*│                          │
│                    └──────┬──────┘                           │
│                           │                                  │
│              ┌────────────┼────────────┐                     │
│              │            │            │                     │
│       ┌──────┴─────┐ ┌───┴────┐ ┌────┴─────┐               │
│       │RecipeService│ │Storage │ │ Socket.IO│               │
│       │ (orchestr.) │ │(SQLite)│ │ (events) │               │
│       └────────────┘ └────────┘ └──────────┘               │
│              │                                              │
│              │  Runtime.Devices.setTagValue / getTagValue   │
│              │                                              │
│              ▼                                              │
│       ┌──────────┐                                          │
│       │ Devices  │ (Modbus, OPC UA, S7, etc.)              │
│       └──────────┘                                          │
└──────────────────────────────────────────────────────────────┘
```

### Server-side modules

| Module | Path | Responsibility |
|---|---|---|
| **API Routes** | `server/api/recipes/index.js` | REST endpoints, validation, import/export |
| **Recipe Service** | `server/runtime/recipes/recipe-service.js` | Download/upload orchestration, value coercion, concurrency guard |
| **Recipe Storage** | `server/runtime/recipes/recipe-storage.js` | SQLite persistence layer |

### Client-side modules

| Module | Path | Responsibility |
|---|---|---|
| **Model** | `client/src/app/_models/recipe.ts` | TypeScript interfaces |
| **Service** | `client/src/app/_services/recipe.service.ts` | HTTP calls to API |
| **Recipe List** | `client/src/app/recipes/recipe-list/` | CRUD table view |
| **Recipe Editor** | `client/src/app/recipes/recipe-editor/` | Edit dialog (name, description, entries) |
| **Recipe Progress** | `client/src/app/recipes/recipe-progress/` | Live progress dialog for download/upload |
| **Tag Browser** | `client/src/app/recipes/tag-browser/` | Tag picker dialog for adding entries |
| **HTML Recipe Widget** | `client/src/app/gauges/controls/html-recipe/` | Runtime gauge widget for HMI views |
| **Recipe New Dialog** | `client/src/app/gauges/controls/html-recipe/html-recipe-new-dialog/` | Modal dialog to create a new recipe from the widget |
| **Recipe Property** | `client/src/app/gauges/controls/html-recipe/recipe-property/` | Designer property panel for the widget |

---

## Data Model

```typescript
interface Recipe {
    id: string;
    name: string;
    description: string;
    entries: RecipeEntry[];
    createdAt?: string;
    updatedAt?: string;
}

interface RecipeEntry {
    id: string;
    tagId: string;
    tagName: string;
    tagType: string;
    value: any;
}
```

**`tagType`** must be one of the following supported types (case-insensitive):

| Category | Types |
|---|---|
| Boolean | `bool`, `boolean` |
| Integer | `int`, `dint`, `int16`, `int32`, `number` |
| Float | `real`, `float`, `double` |
| Byte | `byte` |
| String | `string`, `word` |

### Error / Progress event interfaces

```typescript
interface RecipeProgressEvent {
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

interface RecipeCompleteEvent {
    recipeId: string;
    successCount: number;
    errorCount: number;
    errors: { entryId: string; tagId: string; error: string }[];
}
```

---

## REST API

All endpoints are protected by JWT authentication middleware.

### `GET /api/recipes`
Returns all recipes.

```json
{
    "recipes": [
        { "id": "r_abc123", "data": { "name": "Mixer 101", "entries": [...] } }
    ]
}
```

### `GET /api/recipes/:id`
Returns a single recipe data object.

### `POST /api/recipes`
Create or update a recipe (upsert).

**Request body:**
```json
{
    "id": "r_abc123",
    "name": "Mixer 101",
    "description": "Settings for mixing station",
    "entries": [
        { "id": "e_001", "tagId": "tag_1", "tagName": "Temperature", "tagType": "Real", "value": 85.0 }
    ]
}
```
If `id` is omitted a new one is generated (`r_` + 12 hex chars).

### `DELETE /api/recipes?id=<id>`
Delete a recipe.

### `POST /api/recipes/download`
Start an async **download** (push recipe values to device tags).

**Request:** `{ "id": "r_abc123" }`
**Response (202):** `{ "result": "started", "recipeId": "...", "totalEntries": 10 }`

The actual execution happens asynchronously — progress is reported via
Socket.IO (see [Socket.IO Events](#socketio-events)).

### `POST /api/recipes/upload`
Start an async **upload** (pull device values into the recipe).

Same request/response pattern as download. On completion, the recipe data
is persisted to the database.

### `POST /api/recipes/export`
Export a recipe as JSON or CSV.

**Request:** `{ "id": "r_abc123", "format": "json" }`
**Response:** File download with appropriate `Content-Disposition` header.

### `POST /api/recipes/import`
Import a recipe from JSON or CSV content.

**Request:**
```json
{
    "file": "{ \"name\": \"Imported\", \"entries\": [...] }",
    "format": "json",
    "name": "Optional name override"
}
```

Format is auto-detected from content when omitted.

---

## Socket.IO Events

During download/upload execution the server emits progress events through
Socket.IO so connected clients can display live per-entry status.

| Event | Direction | Payload |
|---|---|---|
| `recipe-download-progress` | Server → Client | `RecipeProgressEvent` |
| `recipe-upload-progress` | Server → Client | `RecipeProgressEvent` |
| `recipe-download-complete` | Server → Client | `RecipeCompleteEvent` |
| `recipe-upload-complete` | Server → Client | `RecipeCompleteEvent` |
| `recipe-download-error` | Server → Client | `{ recipeId, error }` |
| `recipe-upload-error` | Server → Client | `{ recipeId, error }` |

The Angular `HmiService` exposes these as RxJS observables:

```typescript
hmiService.onRecipeDownloadProgress  // Observable<RecipeProgressEvent>
hmiService.onRecipeUploadProgress    // Observable<RecipeProgressEvent>
hmiService.onRecipeDownloadComplete  // Observable<RecipeCompleteEvent>
hmiService.onRecipeUploadComplete    // Observable<RecipeCompleteEvent>
hmiService.onRecipeDownloadError     // Observable<any>
hmiService.onRecipeUploadError       // Observable<any>
```

---

## Value Type Coercion

When writing values to device tags, the `coerceValue` function in
`recipe-service.js` converts raw values to the correct JavaScript type
based on the declared `tagType`:

| tagType | Behaviour |
|---|---|
| `bool` / `boolean` | `"true"`, `"1"` → `true`; `"false"`, `"0"` → `false`; booleans pass through |
| `int` / `dint` / `int16` / `int32` / `number` | `parseInt(value, 10)`; returns original string if `NaN` |
| `real` / `float` / `double` | `parseFloat(value)`; returns original string if `NaN` |
| `byte` | `parseInt` then clamped to [0, 255] |
| `string` / `word` | Pass-through, no coercion |

The API also validates value coercibility on save — entries whose string
value cannot be meaningfully converted to the declared type are rejected
at the HTTP layer.

---

## Concurrency

The recipe service prevents concurrent executions of the **same** recipe
via a `Set<string>` guard (`runningRecipes`):

- `isRecipeRunning(id)` — returns `true` while a download or upload is active
- The API checks this before starting new executions and returns `400`
  if a conflicting operation is in progress.
- The guard is cleaned up in the `finally` block so a crash or error never
  leaves a stale lock.

Different recipes can execute simultaneously. Only duplicate recipe IDs
are blocked.

---

## Client UI

### Recipe List (`RecipeListComponent`)

The main management view shows a sortable table with columns:
Name, Description, Entries (count), Updated At, and Actions.

Each row provides:
- **Edit** — opens the editor dialog
- **Download** — starts push execution and opens the progress dialog
- **Upload** — starts pull execution and opens the progress dialog
- **Export** — dropdown to export as JSON or CSV
- **Delete** — with confirmation prompt

An **Import** button in the toolbar reads a local JSON or CSV file and
sends it to the API.

### Recipe Editor (`RecipeEditorComponent`)

A dialog with:
- Name and description fields
- An entries table where each row shows tag ID, name, type badge, and an
  editable value input (type-aware: slide-toggle for booleans, `<input
  type="number">` for numerics, text input for strings).
- An **Add Entry** button that opens the Tag Browser dialog.
- Remove buttons per row.

### Recipe Progress (`RecipeProgressComponent`)

A dialog showing:
- A determinate progress bar
- Entry count (X of Y)
- Live per-entry status list (pending → writing/reading → success/error)
- Error summary when execution completes with failures
- Cancel button to abort the operation

### Tag Browser (`TagBrowserComponent`)

A dialog with a two-panel layout:
- Left panel: device list
- Right panel: tags for the selected device, with a text filter
- Clicking a tag closes the dialog and returns the selected tag data

### HTML Recipe Widget (`HtmlRecipeViewComponent`)

A runtime gauge widget that can be placed on HMI views via the SVG editor.
It provides:

- A recipe selector dropdown
- Editable entries table (value column only, for operator input)
- Action buttons: New Recipe / Save / Download / Upload
- **New Recipe** — opens a modal dialog (`HtmlRecipeNewDialogComponent`)
  where the operator can enter a custom name and description (both
  pre-filled with "New Recipe"), then creates the recipe by cloning the
  current recipe's entries with sanitised defaults.
- **Save** — sanitises `null`/`undefined` values before persisting
  (prevents Angular `NgModel` + `type="number"` from injecting `null`
  into the database).
- **Download** — applies the same sanitisation before persisting and
  pushing values to the device.
- Read-only mode (configured in the designer)
- Configurable colours (background, text, border, accent)
- Visual feedback during operations (progress bar, error state, loading
  spinner)

The widget applies `_sanitizeEntries()` on every save, download, and new-recipe
operation to coerce `null`/`undefined` entry values to the correct default
per `tagType`:

| tagType | `null`/`undefined` becomes |
|---|---|
| `bool` / `boolean` | `false` |
| `int` / `dint` / `int16` / `int32` / `number` | `0` |
| `real` / `float` / `double` | `0` |
| `byte` | `0` |
| `string` / `word` / default | `""` |

---

## Validation Rules (server-side)

Applied on every create/update/import:

| Rule | Constraint |
|---|---|
| `name` | Required, max 128 characters |
| `description` | Optional, max 512 characters |
| `entries` | Required, at least 1, max 1000 |
| `entry.tagId` | Required, non-empty string |
| `entry.tagType` | Required, must be a supported type |
| Value coercion | String values must be parseable to the declared numeric type |

---

## Database Schema

Recipes are stored in a SQLite file (`recipes.db`) in the server working
directory.

```sql
CREATE TABLE recipes (
    id         TEXT PRIMARY KEY,
    data       TEXT NOT NULL,       -- JSON-serialised Recipe object
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## File Reference

| File | Lines | Role |
|---|---|---|
| `server/api/recipes/index.js` | 454 | REST endpoints, validation, CSV/JSON import/export |
| `server/runtime/recipes/recipe-service.js` | 268 | Download/upload orchestration, value coercion |
| `server/runtime/recipes/recipe-storage.js` | 190 | SQLite CRUD operations |
| `server/test/help/recipeService.test.js` | 118 | Unit tests for `coerceValue` |
| `client/src/app/_models/recipe.ts` | 45 | TypeScript interfaces |
| `client/src/app/_services/recipe.service.ts` | 59 | HTTP service |
| `client/src/app/recipes/recipe-list/` | 3 files | List component (ts, html, css) |
| `client/src/app/recipes/recipe-editor/` | 3 files | Editor dialog |
| `client/src/app/recipes/recipe-progress/` | 3 files | Progress dialog |
| `client/src/app/recipes/tag-browser/` | 3 files | Tag picker dialog |
| `client/src/app/gauges/controls/html-recipe/` | 9 files | Widget + new-dialog + property panel |
