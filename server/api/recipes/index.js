/**
 * 'api/recipes' — REST endpoints for recipe CRUD, import/export, and
 *                 async download/upload execution.
 *
 * All routes are secured via JWT middleware.
 */

'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const authJwt = require('../jwt-helper');

const VALID_TAG_TYPES = ['number', 'string', 'boolean', 'bool', 'int', 'dint', 'int16', 'int32', 'real', 'float', 'double', 'byte', 'word'];

let runtime;
let secureFnc;
let checkGroupsFnc;

module.exports = {
    /**
     * Initialize the module with runtime dependencies.
     * @param {object} _runtime
     * @param {Function} _secureFnc — JWT auth middleware
     * @param {Function} _checkGroupsFnc — Group permission middleware
     */
    init: function (_runtime, _secureFnc, _checkGroupsFnc) {
        runtime = _runtime;
        secureFnc = _secureFnc;
        checkGroupsFnc = _checkGroupsFnc;
    },

    /**
     * Build and return the Express sub-application.
     * @returns {express.Router}
     */
    app: function () {
        const recipesApp = express();

        recipesApp.use(function (req, res, next) {
            if (!runtime.project) {
                res.status(404).end();
            } else {
                next();
            }
        });

        // -----------------------------------------------------------------------
        // GET /api/recipes[/:id] — list all or fetch one recipe
        // -----------------------------------------------------------------------
        recipesApp.get('/api/recipes/:id?', secureFnc, function (req, res) {
            const recipeId = req.query.id || req.params.id;

            if (recipeId) {
                _handlePromise(
                    runtime.recipeStorage.getRecipeData(recipeId),
                    res,
                    (result) => {
                        if (result) {
                            res.json(result);
                        } else {
                            res.status(404).json({ error: 'Recipe not found' });
                        }
                    },
                    'get recipe data'
                );
            } else {
                _handlePromise(
                    runtime.recipeStorage.getAllRecipes(),
                    res,
                    (recipes) => res.json({ recipes: recipes || [] }),
                    'get recipes'
                );
            }
        });

        // -----------------------------------------------------------------------
        // POST /api/recipes — create or update a recipe (upsert)
        // -----------------------------------------------------------------------
        recipesApp.post('/api/recipes', secureFnc, function (req, res) {
            const body = req.body;
            if (!body) {
                return res.status(400).json({ error: 'Missing request body' });
            }

            const validation = _validateRecipeData(body);
            if (!validation.valid) {
                return res.status(400).json({ error: 'Invalid recipe data: ' + validation.error });
            }

            const recipeId = body.id || 'r_' + crypto.randomBytes(6).toString('hex');
            const recipeData = {
                name: body.name,
                description: body.description || '',
                entries: body.entries || []
            };

            _handlePromise(
                runtime.recipeStorage.setRecipeData(recipeId, recipeData),
                res,
                () => res.json({ id: recipeId }),
                'set recipe data'
            );
        });

        // -----------------------------------------------------------------------
        // DELETE /api/recipes — delete a recipe by query param ?id=
        // -----------------------------------------------------------------------
        recipesApp.delete('/api/recipes', secureFnc, function (req, res) {
            if (!req.query || !req.query.id) {
                return res.status(400).json({ error: 'Missing recipe id parameter' });
            }

            const recipeId = req.query.id;
            _handlePromise(
                runtime.recipeStorage.deleteRecipeData(recipeId),
                res,
                (result) => {
                    if (result.changes === 0) {
                        res.status(404).json({ error: 'Recipe not found' });
                    } else {
                        res.json({ result: 'ok', deleted: result.changes });
                    }
                },
                'delete recipe'
            );
        });

        // -----------------------------------------------------------------------
        // POST /api/recipes/download — start async download (push)
        // -----------------------------------------------------------------------
        recipesApp.post('/api/recipes/download', secureFnc, function (req, res) {
            const body = req.body;
            if (!body || !body.id) {
                return res.status(400).json({ error: 'Missing recipe id' });
            }

            _handlePromise(
                runtime.recipeStorage.getRecipeData(body.id),
                res,
                (recipeData) => {
                    if (!recipeData) {
                        return res.status(400).json({ error: 'Recipe not found' });
                    }

                    const entries = recipeData.entries || [];
                    if (entries.length === 0) {
                        return res.status(400).json({ error: 'No entries to download' });
                    }

                    if (runtime.recipeService.isRecipeRunning(body.id)) {
                        return res.status(400).json({ error: 'Recipe execution already in progress' });
                    }

                    runtime.recipeService.downloadRecipe(body.id).catch(err => {
                        runtime.logger.error('download recipe error! ' + err);
                    });

                    res.status(202).json({ result: 'started', recipeId: body.id, totalEntries: entries.length });
                },
                'download recipe'
            );
        });

        // -----------------------------------------------------------------------
        // POST /api/recipes/upload — start async upload (pull)
        // -----------------------------------------------------------------------
        recipesApp.post('/api/recipes/upload', secureFnc, function (req, res) {
            const body = req.body;
            if (!body || !body.id) {
                return res.status(400).json({ error: 'Missing recipe id' });
            }

            _handlePromise(
                runtime.recipeStorage.getRecipeData(body.id),
                res,
                (recipeData) => {
                    if (!recipeData) {
                        return res.status(400).json({ error: 'Recipe not found' });
                    }

                    const entries = recipeData.entries || [];
                    if (entries.length === 0) {
                        return res.status(400).json({ error: 'No entries to upload' });
                    }

                    if (runtime.recipeService.isRecipeRunning(body.id)) {
                        return res.status(400).json({ error: 'Recipe execution already in progress' });
                    }

                    runtime.recipeService.uploadRecipe(body.id).catch(err => {
                        runtime.logger.error('upload recipe error! ' + err);
                    });

                    res.status(202).json({ result: 'started', recipeId: body.id, totalEntries: entries.length });
                },
                'upload recipe'
            );
        });

        // -----------------------------------------------------------------------
        // POST /api/recipes/export — export recipe as JSON or CSV file
        // -----------------------------------------------------------------------
        recipesApp.post('/api/recipes/export', secureFnc, function (req, res) {
            const body = req.body;
            if (!body || !body.id) {
                return res.status(400).json({ error: 'Missing recipe id' });
            }

            const format = body.format || 'json';
            if (format !== 'json' && format !== 'csv') {
                return res.status(400).json({ error: 'Invalid format. Use "json" or "csv"' });
            }

            _handlePromise(
                runtime.recipeStorage.getRecipeData(body.id),
                res,
                (recipeData) => {
                    if (!recipeData) {
                        return res.status(404).json({ error: 'Recipe not found' });
                    }

                    const entries = recipeData.entries || [];
                    const recipeName = (recipeData.name || 'recipe').replace(/[^a-zA-Z0-9_-]/g, '_');

                    if (format === 'json') {
                        const jsonContent = JSON.stringify(recipeData, null, 2);
                        res.setHeader('Content-Type', 'application/json');
                        res.setHeader('Content-Disposition', 'attachment; filename="' + recipeName + '.json"');
                        res.send(jsonContent);
                    } else {
                        const csvLines = ['tagId,tagName,tagType,value'];
                        for (let i = 0; i < entries.length; i++) {
                            const e = entries[i];
                            const value = (e.value !== undefined && e.value !== null)
                                ? String(e.value).replace(/"/g, '""')
                                : '';
                            csvLines.push('"' + (e.tagId || '') + '","' + (e.tagName || '') + '","' + (e.tagType || '') + '","' + value + '"');
                        }
                        const csvContent = csvLines.join('\n');
                        res.setHeader('Content-Type', 'text/csv');
                        res.setHeader('Content-Disposition', 'attachment; filename="' + recipeName + '.csv"');
                        res.send(csvContent);
                    }
                },
                'export recipe'
            );
        });

        // -----------------------------------------------------------------------
        // POST /api/recipes/import — import recipe from JSON or CSV payload
        // -----------------------------------------------------------------------
        recipesApp.post('/api/recipes/import', secureFnc, function (req, res) {
            const body = req.body;
            if (!body) {
                return res.status(400).json({ error: 'Missing request body' });
            }

            const fileContent = body.file || body.data;
            let format = body.format;

            if (!fileContent) {
                return res.status(400).json({ error: 'Missing file data' });
            }

            // Auto-detect format from content if not specified
            if (!format) {
                if (typeof fileContent === 'string') {
                    const trimmed = fileContent.trim();
                    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                        format = 'json';
                    } else if (trimmed.includes(',')) {
                        format = 'csv';
                    }
                } else if (typeof fileContent === 'object') {
                    format = 'json';
                }
            }

            if (format === 'json') {
                _importJson(fileContent, body.name, body.description, res);
            } else if (format === 'csv') {
                _importCsv(fileContent, body.name, body.description, res);
            } else {
                res.status(400).json({ error: 'Invalid file format. Use "json" or "csv"' });
            }
        });

        return recipesApp;
    }
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a Promise-based operation with consistent error logging and response.
 * @param {Promise} promise
 * @param {object} res — Express response object
 * @param {Function} onSuccess — Called with resolved value
 * @param {string} label — Human-readable label for error logs
 */
function _handlePromise(promise, res, onSuccess, label) {
    promise.then(onSuccess).catch(err => {
        runtime.logger.error(label + ' error! ' + err);
        res.status(500).json({ error: err.message });
    });
}

/**
 * Parse a CSV line respecting RFC 4180 quoted fields.
 * @param {string} line
 * @returns {string[]}
 */
function _parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
    }
    result.push(current.trim());
    return result;
}

/**
 * Validate that a recipe data object has the required structure.
 * Checks name length, entry count limits, tag types, and value coercibility.
 * @param {object} data
 * @returns {{ valid: boolean, error?: string }}
 */
function _validateRecipeData(data) {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Data must be an object' };
    }

    if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
        return { valid: false, error: 'name is required' };
    }

    if (data.name.length > 128) {
        return { valid: false, error: 'name must be 128 characters or less' };
    }

    if (data.description && data.description.length > 512) {
        return { valid: false, error: 'description must be 512 characters or less' };
    }

    if (!data.entries || !Array.isArray(data.entries) || data.entries.length === 0) {
        return { valid: false, error: 'Recipe must have at least one entry' };
    }

    if (data.entries.length > 1000) {
        return { valid: false, error: 'Recipe must have 1000 entries or less' };
    }

    for (let i = 0; i < data.entries.length; i++) {
        const entry = data.entries[i];

        if (!entry.tagId || typeof entry.tagId !== 'string' || entry.tagId.trim() === '') {
            return { valid: false, error: 'Entry ' + (i + 1) + ': tagId is required' };
        }

        if (!entry.tagType || typeof entry.tagType !== 'string') {
            return { valid: false, error: 'Entry ' + (i + 1) + ': tagType is required' };
        }

        if (!VALID_TAG_TYPES.includes(entry.tagType.toLowerCase())) {
            return { valid: false, error: 'Entry ' + (i + 1) + ': invalid tagType "' + entry.tagType + '"' };
        }

        // Validate that string values can be coerced to the declared type
        if (entry.value !== undefined && entry.value !== null) {
            const type = entry.tagType.toLowerCase();
            if (type === 'number' || type === 'int' || type === 'dint' || type === 'int16' || type === 'int32') {
                if (typeof entry.value === 'string' && isNaN(parseInt(entry.value, 10))) {
                    return { valid: false, error: 'Entry ' + (i + 1) + ": value '" + entry.value + "' cannot be coerced to type '" + entry.tagType + "'" };
                }
            } else if (type === 'real' || type === 'float' || type === 'double') {
                if (typeof entry.value === 'string' && isNaN(parseFloat(entry.value))) {
                    return { valid: false, error: 'Entry ' + (i + 1) + ": value '" + entry.value + "' cannot be coerced to type '" + entry.tagType + "'" };
                }
            }
        }
    }

    return { valid: true };
}

/**
 * Import a recipe from a JSON payload.
 * @param {string|object} fileContent
 * @param {string} [name]
 * @param {string} [description]
 * @param {object} res — Express response object
 */
function _importJson(fileContent, name, description, res) {
    let recipeData;
    try {
        if (typeof fileContent === 'string') {
            recipeData = JSON.parse(fileContent);
        } else {
            recipeData = fileContent;
        }
    } catch (parseErr) {
        return res.status(400).json({ error: 'Invalid JSON file: ' + parseErr.message });
    }

    const validation = _validateRecipeData(recipeData);
    if (!validation.valid) {
        return res.status(400).json({ error: 'Import validation failed: ' + validation.error });
    }

    const recipeId = 'r_' + crypto.randomBytes(6).toString('hex');
    _handlePromise(
        runtime.recipeStorage.setRecipeData(recipeId, recipeData),
        res,
        () => res.json({ id: recipeId, name: recipeData.name, entriesCount: recipeData.entries.length }),
        'import recipe'
    );
}

/**
 * Import a recipe from a CSV string.
 * Expects columns: tagId, tagName, tagType, value
 * @param {string} fileContent
 * @param {string} [name]
 * @param {string} [description]
 * @param {object} res — Express response object
 */
function _importCsv(fileContent, name, description, res) {
    try {
        const lines = fileContent.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
            return res.status(400).json({
                error: 'Import validation failed: CSV must have header and at least one data row'
            });
        }

        const header = _parseCSVLine(lines[0]);
        const tagIdIdx = header.indexOf('tagId');
        const tagNameIdx = header.indexOf('tagName');
        const tagTypeIdx = header.indexOf('tagType');
        const valueIdx = header.indexOf('value');

        if (tagIdIdx === -1 || tagTypeIdx === -1) {
            return res.status(400).json({
                error: 'Import validation failed: CSV must have tagId and tagType columns'
            });
        }

        const entries = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = _parseCSVLine(lines[i]);
            const tagId = cols[tagIdIdx] || '';
            const tagName = tagNameIdx >= 0 ? cols[tagNameIdx] || '' : '';
            const tagType = cols[tagTypeIdx] || 'string';
            const value = valueIdx >= 0 ? cols[valueIdx] : '';

            if (!tagId) {
                return res.status(400).json({ error: 'Import validation failed: entry ' + i + ' has empty tagId' });
            }

            entries.push({
                id: 'e_' + crypto.randomBytes(4).toString('hex'),
                tagId,
                tagName,
                tagType,
                value
            });
        }

        const recipeName = name || 'Imported_' + new Date().toISOString().slice(0, 10);
        const importData = {
            name: recipeName,
            description: description || '',
            entries
        };

        const validation = _validateRecipeData(importData);
        if (!validation.valid) {
            return res.status(400).json({ error: 'Import validation failed: ' + validation.error });
        }

        const recipeId = 'r_' + crypto.randomBytes(6).toString('hex');
        _handlePromise(
            runtime.recipeStorage.setRecipeData(recipeId, importData),
            res,
            () => res.json({ id: recipeId, name: importData.name, entriesCount: entries.length }),
            'import recipe'
        );
    } catch (parseErr) {
        return res.status(400).json({ error: 'Invalid CSV file: ' + parseErr.message });
    }
}
