# TypeScript `strictPropertyInitialization` Analysis

Date: 2026-05-27
Scope: `FUXA/client/src/` (excluding `node_modules`, `.spec.ts`, `test.ts`)

---

## Background

TypeScript's `strictPropertyInitialization` (enabled under `strict: true`) requires all class properties to be initialized either inline or in the constructor. Properties assigned in lifecycle hooks (`ngOnInit`, `ngAfterViewInit`, etc.) or setter methods are **not** recognized by the compiler, producing:

> `Property 'X' has no initializer and is not definitely assigned in the constructor.`

---

## Already Fixed (Recipe Module)

| File | Properties | Fix |
|---|---|---|
| `html-recipe.component.ts` | `subscriptionDownloadProgress` · `subscriptionDownloadComplete` · `subscriptionDownloadError` · `subscriptionUploadProgress` · `subscriptionUploadComplete` · `subscriptionUploadError` · `defaultRecipeId` | Added `!` |
| `recipe-list.component.ts` | `subscriptionLoad` · `subscriptionDownloadComplete` · `subscriptionUploadComplete` | Added `!` |
| `recipe-progress.component.ts` | `subscriptionProgress` · `subscriptionComplete` · `subscriptionError` | Added `!` |

**Note:** `subscriptionDownloadComplete` and `subscriptionUploadComplete` in `recipe-list.component.ts` are never assigned anywhere — dead code.

---

## Category 1 — Never Assigned (Highest Risk)

Properties declared with a type but **no assignment anywhere** in the file. Accessing them before assignment yields `undefined` at runtime.

### `fuxa-view.component.ts` — Class `CardModel` (lines 1194–1211)

```typescript
public name: string;           // line 1195
public link: string;           // line 1196
public x: number;              // line 1197
public y: number;              // line 1198
public scale: number;          // line 1199
public scaleX: number;         // line 1200
public scaleY: number;         // line 1201
public width: number;          // line 1202
public height: number;         // line 1203
public view: View;             // line 1205
public sourceDeviceId: string; // line 1206
```

Constructor only sets `this.id`. All other properties are `undefined`.

### `fuxa-view.component.ts` — Class `DialogModalModel` (lines 1217–1227)

```typescript
public name: string;       // line 1218
public width: number;      // line 1219
public height: number;     // line 1220
public bkcolor: string;    // line 1221
public view: View;         // line 1222
```

Same pattern — constructor only sets `this.id`.

### `bitmask.component.ts` — Class `Bit` (lines 48–50)

```typescript
public id: number;      // line 48
public label: string;   // line 49
public selected: boolean; // line 50
```

No constructor exists at all.

### `header.component.ts` — Class `HeaderComponent` (line 37)

```typescript
private subscriptionShowHelp: Subscription;
```

Never assigned — appears only in `_safeUnsubscribe(this.subscriptionShowHelp)`. Dead code.

---

## Category 2 — Assigned Outside Constructor (Same Pattern We Fixed)

Properties assigned in lifecycle hooks or custom methods. The compiler cannot statically verify them.

### `lazyFor.directive.ts` (lines 30–40)

| Property | Assigned In |
|---|---|
| `templateElem: HTMLElement` | `ngOnInit` |
| `beforeListElem: HTMLElement` | runtime method |
| `afterListElem: HTMLElement` | runtime method |
| `differ: IterableDiffer<any>` | `ngDoCheck` |

### `ar-marker-scanner.service.ts` (lines 12–16)

| Property | Assigned In |
|---|---|
| `barcodeDetector: BarcodeDetectorLike` | `init()` |
| `html5Qrcode: Html5Qrcode` | `init()` |
| `html5QrcodeElement: HTMLDivElement` | `init()` |
| `canvas: HTMLCanvasElement` | `init()` |
| `context: CanvasRenderingContext2D` | `init()` |

### `daterangepicker.directive.ts` (line 48)

```typescript
private _value: any;
```

Assigned via a setter, not in the constructor.

---

## Category 3 — Assigned in Constructor (Compiler-Safe)

~65 properties across ~30+ files match the raw search pattern but are initialized in the constructor body. TypeScript recognizes these and does not emit warnings. **No action needed.**

Common examples:

| File | Properties |
|---|---|
| `app.component.ts` | `subscription*` |
| `alarm-list.component.ts` | `subscription*` |
| `editor.component.ts` | `subscription*` |
| `home.component.ts` | `subscription*` |
| `device.component.ts` | `subscription*` |
| `view.component.ts` | `subscription*` |
| `apikeys.service.ts` | `storage` |
| `auth.service.ts` | `currentUser` |
| `command.service.ts` | `server` |
| `project.service.ts` | `serverSettings`, `storage` |
| `user.service.ts` | `storage` |

---

## Summary

| Category | Properties | Files | Risk |
|---|---|---|---|
| C1 — Never assigned | 17 | 3 | High — runtime `undefined` |
| C2 — Outside constructor | ~12 | 4+ | Medium — works but compiler warns |
| C3 — In constructor | ~65 | ~30+ | None — already correct |

**Most impactful targets:** `CardModel` / `DialogModalModel` in `fuxa-view.component.ts` (13 properties, never initialized), `Bit` in `bitmask.component.ts` (3 properties, no constructor).
