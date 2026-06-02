/**
 * Recipe Service — orchestrates download (push values to devices) and
 * upload (pull values from devices) execution for recipes.
 *
 * Progress is reported in real-time via Socket.IO events so the UI
 * can display per-entry status during long-running operations.
 */

'use strict';

const Events = require('../events');

let logger;
let runtime;

/** Track active executions per recipe ID to prevent concurrent same-recipe operations */
const runningRecipes = new Set();

/**
 * Initialize the service module.
 * @param {object} settings — App settings (unused, kept for interface compatibility)
 * @param {object} _logger — Logger instance
 * @param {object} _runtime — Runtime context (exposes devices, recipeStorage, io)
 * @returns {Promise<object>} Public API surface
 */
function init(settings, _logger, _runtime) {
    runtime = _runtime;
    logger = _logger || console;

    return Promise.resolve({
        downloadRecipe,
        uploadRecipe,
        cancelRecipe
    });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download (push) recipe values to device tags.
 * Iterates entries sequentially, calling setTagValue per entry and emitting
 * per-entry progress events over Socket.IO.
 * @param {string} recipeId — Recipe UUID
 * @returns {Promise<void>}
 */
async function downloadRecipe(recipeId) {
    if (runningRecipes.has(recipeId)) {
        throw new Error('Recipe execution already in progress');
    }

    runningRecipes.add(recipeId);

    try {
        const recipeData = await runtime.recipeStorage.getRecipeData(recipeId);
        if (!recipeData) {
            throw new Error('Recipe not found');
        }

        const entries = recipeData.entries || [];
        if (entries.length === 0) {
            throw new Error('No entries to download');
        }

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];

            _emitProgress('download', { recipeId, entry, index: i, total: entries.length, status: 'writing' });

            try {
                const coercedValue = _coerceValue(entry.value, entry.tagType);
                const result = await runtime.devices.setTagValue(entry.tagId, coercedValue);

                if (result) {
                    successCount++;
                    _emitProgress('download', {
                        recipeId, entry, index: i, total: entries.length,
                        status: 'success', value: coercedValue
                    });
                } else {
                    errorCount++;
                    const errorMsg = 'Tag write returned null';
                    errors.push({ entryId: entry.id, tagId: entry.tagId, error: errorMsg });
                    _emitProgress('download', {
                        recipeId, entry, index: i, total: entries.length,
                        status: 'error', error: errorMsg
                    });
                }
            } catch (err) {
                errorCount++;
                errors.push({ entryId: entry.id, tagId: entry.tagId, error: err.message });
                _emitProgress('download', {
                    recipeId, entry, index: i, total: entries.length,
                    status: 'error', error: err.message
                });
            }
        }

        runtime.io.emit(Events.IoEventTypes.RECIPE_DOWNLOAD_COMPLETE, {
            recipeId, successCount, errorCount, errors
        });
    } catch (err) {
        runtime.io.emit(Events.IoEventTypes.RECIPE_DOWNLOAD_ERROR, {
            recipeId, error: err.message
        });
    } finally {
        runningRecipes.delete(recipeId);
    }
}

/**
 * Upload (pull) current device values into the recipe.
 * Iterates entries sequentially, calling getTagValue per entry, and persists
 * the updated recipe to the database if at least one entry succeeded.
 * @param {string} recipeId — Recipe UUID
 * @returns {Promise<void>}
 */
async function uploadRecipe(recipeId) {
    if (runningRecipes.has(recipeId)) {
        throw new Error('Recipe execution already in progress');
    }

    runningRecipes.add(recipeId);

    try {
        const recipeData = await runtime.recipeStorage.getRecipeData(recipeId);
        if (!recipeData) {
            throw new Error('Recipe not found');
        }

        const entries = recipeData.entries || [];
        if (entries.length === 0) {
            throw new Error('No entries to upload');
        }

        let successCount = 0;
        let errorCount = 0;
        const errors = [];
        const newEntries = [];

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];

            _emitProgress('upload', { recipeId, entry, index: i, total: entries.length, status: 'reading' });

            try {
                const tagValue = await runtime.devices.getTagValue(entry.tagId);

                if (tagValue !== undefined && tagValue !== null) {
                    successCount++;
                    const newEntry = { ...entry, value: tagValue };
                    newEntries.push(newEntry);
                    _emitProgress('upload', {
                        recipeId, entry, index: i, total: entries.length,
                        status: 'success', value: tagValue
                    });
                } else {
                    errorCount++;
                    const errorMsg = 'Tag read returned null';
                    errors.push({ entryId: entry.id, tagId: entry.tagId, error: errorMsg });
                    newEntries.push(entry);
                    _emitProgress('upload', {
                        recipeId, entry, index: i, total: entries.length,
                        status: 'error', error: errorMsg
                    });
                }
            } catch (err) {
                errorCount++;
                errors.push({ entryId: entry.id, tagId: entry.tagId, error: err.message });
                newEntries.push(entry);
                _emitProgress('upload', {
                    recipeId, entry, index: i, total: entries.length,
                    status: 'error', error: err.message
                });
            }
        }

        // Only persist if at least some entries succeeded
        if (successCount > 0) {
            recipeData.entries = newEntries;
            recipeData.updatedAt = new Date().toISOString();
            await runtime.recipeStorage.setRecipeData(recipeId, recipeData);
        }

        runtime.io.emit(Events.IoEventTypes.RECIPE_UPLOAD_COMPLETE, {
            recipeId, successCount, errorCount, errors
        });
    } catch (err) {
        runtime.io.emit(Events.IoEventTypes.RECIPE_UPLOAD_ERROR, {
            recipeId, error: err.message
        });
    } finally {
        runningRecipes.delete(recipeId);
    }
}

/**
 * Check whether a recipe execution is currently in progress.
 * @param {string} recipeId
 * @returns {boolean}
 */
function isRecipeRunning(recipeId) {
    return runningRecipes.has(recipeId);
}

/**
 * Cancel a running recipe execution by removing it from the active set.
 * The in-flight async operations will still complete, but no further
 * events will be emitted after the guard check.
 * @param {string} recipeId
 */
function cancelRecipe(recipeId) {
    if (runningRecipes.has(recipeId)) {
        runningRecipes.delete(recipeId);
        logger.info('Recipe ' + recipeId + ' execution cancelled');
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Coerce a raw value to the appropriate JavaScript type for a given tag type.
 * Used before writing values to devices so the protocol layer receives
 * properly-typed data.
 * @param {*} value — The value to coerce
 * @param {string} tagType — Tag type name (e.g. "Bool", "Real", "Int", "String")
 * @returns {*} Coerced value, or the original if coercion is not possible
 */
function _coerceValue(value, tagType) {
    if (value === undefined || value === null) {
        return value;
    }

    const type = (tagType || '').toLowerCase();

    // Boolean family
    if (type === 'bool' || type === 'boolean') {
        if (typeof value === 'boolean') return value;
        return value === 'true' || value === '1';
    }

    // Integer family
    if (type === 'int' || type === 'dint' || type === 'int16' || type === 'int32' || type === 'number') {
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? value : parsed;
    }

    // Float / Real family
    if (type === 'real' || type === 'float' || type === 'double') {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? value : parsed;
    }

    // Byte: clamp 0–255
    if (type === 'byte') {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) return value;
        return Math.max(0, Math.min(255, parsed));
    }

    // String / Word — pass through as-is
    return value;
}

/**
 * Emit a progress event for a running recipe operation over Socket.IO.
 * @param {'download' | 'upload'} direction
 * @param {object} payload
 * @param {string} payload.recipeId
 * @param {object} payload.entry
 * @param {number} payload.index
 * @param {number} payload.total
 * @param {string} payload.status
 * @param {*} [payload.value]
 * @param {string} [payload.error]
 */
function _emitProgress(direction, { recipeId, entry, index, total, status, value, error }) {
    const eventName = direction === 'download'
        ? Events.IoEventTypes.RECIPE_DOWNLOAD_PROGRESS
        : Events.IoEventTypes.RECIPE_UPLOAD_PROGRESS;

    runtime.io.emit(eventName, {
        recipeId,
        entryId: entry.id,
        tagId: entry.tagId,
        tagName: entry.tagName,
        index,
        total,
        status,
        value,
        error
    });
}

module.exports = {
    init,
    downloadRecipe,
    uploadRecipe,
    cancelRecipe,
    isRecipeRunning,
    coerceValue: _coerceValue
};
