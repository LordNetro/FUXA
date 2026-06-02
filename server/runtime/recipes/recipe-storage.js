/**
 * Recipe Storage — SQLite persistence layer for recipe configurations.
 *
 * Each recipe is stored as a row with a JSON-serialized data blob.
 * Schema:
 *   recipes (id TEXT PK, data TEXT, created_at DATETIME, updated_at DATETIME)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const TABLE_RECIPES = 'recipes';

let settings;
let logger;
let runtime;
let recipeDB;

/**
 * Initialize the storage module.
 * Creates the SQLite database file and table on first call.
 * @param {object} _settings — App settings (must contain workDir)
 * @param {object} _log — Logger instance
 * @param {object} _runtime — Runtime context
 * @returns {Promise<void>}
 */
function init(_settings, _log, _runtime) {
    settings = _settings;
    logger = _log;
    runtime = _runtime;

    return _createDB();
}

/**
 * Open (or create) the SQLite database and ensure the recipes table exists.
 * @returns {Promise<void>}
 */
function _createDB() {
    return new Promise((resolve, reject) => {
        const dbPath = path.join(settings.workDir, 'recipes.db');
        recipeDB = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                logger.error('recipe-storage DB connection error: ' + err);
                reject(err);
                return;
            }

            const createTableSQL = `
                CREATE TABLE IF NOT EXISTS ${TABLE_RECIPES} (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `;

            recipeDB.run(createTableSQL, (err) => {
                if (err) {
                    logger.error('recipe-storage table creation error: ' + err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

/**
 * Retrieve a single recipe's data blob by its ID.
 * @param {string} recipeId — Recipe UUID
 * @returns {Promise<object|null>} Parsed recipe data, or null if not found
 */
function getRecipeData(recipeId) {
    return new Promise((resolve, reject) => {
        if (!recipeDB) {
            reject(new Error('Recipe database not initialized'));
            return;
        }

        const sql = `SELECT data FROM ${TABLE_RECIPES} WHERE id = ?`;
        recipeDB.get(sql, [recipeId], (err, row) => {
            if (err) {
                logger.error('recipe-storage get error: ' + err);
                reject(err);
            } else if (row) {
                try {
                    resolve(JSON.parse(row.data));
                } catch (parseErr) {
                    logger.error('recipe-storage JSON parse error: ' + parseErr);
                    reject(parseErr);
                }
            } else {
                resolve(null);
            }
        });
    });
}

/**
 * Persist (insert or replace) a recipe's data blob.
 * @param {string} recipeId — Recipe UUID
 * @param {object} data — Serializable recipe data object
 * @returns {Promise<{changes: number}>}
 */
function setRecipeData(recipeId, data) {
    return new Promise((resolve, reject) => {
        if (!recipeDB) {
            reject(new Error('Recipe database not initialized'));
            return;
        }

        const jsonData = JSON.stringify(data);
        const sql = `
            INSERT OR REPLACE INTO ${TABLE_RECIPES} (id, data, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `;

        recipeDB.run(sql, [recipeId, jsonData], function (err) {
            if (err) {
                logger.error('recipe-storage set error: ' + err);
                reject(err);
            } else {
                resolve({ changes: this.changes });
            }
        });
    });
}

/**
 * Retrieve all recipes as an array of { id, data } objects.
 * @returns {Promise<Array<{id: string, data: object}>>}
 */
function getAllRecipes() {
    return new Promise((resolve, reject) => {
        if (!recipeDB) {
            reject(new Error('Recipe database not initialized'));
            return;
        }

        const sql = `SELECT id, data FROM ${TABLE_RECIPES}`;
        recipeDB.all(sql, [], (err, rows) => {
            if (err) {
                logger.error('recipe-storage get all error: ' + err);
                reject(err);
            } else {
                try {
                    const recipes = rows.map(row => ({
                        id: row.id,
                        data: JSON.parse(row.data)
                    }));
                    resolve(recipes);
                } catch (parseErr) {
                    logger.error('recipe-storage JSON parse error: ' + parseErr);
                    reject(parseErr);
                }
            }
        });
    });
}

/**
 * Delete a recipe by its ID.
 * @param {string} recipeId — Recipe UUID
 * @returns {Promise<{changes: number}>}
 */
function deleteRecipeData(recipeId) {
    return new Promise((resolve, reject) => {
        if (!recipeDB) {
            reject(new Error('Recipe database not initialized'));
            return;
        }

        const sql = `DELETE FROM ${TABLE_RECIPES} WHERE id = ?`;
        recipeDB.run(sql, [recipeId], function (err) {
            if (err) {
                logger.error('recipe-storage delete error: ' + err);
                reject(err);
            } else {
                resolve({ changes: this.changes });
            }
        });
    });
}

/**
 * Gracefully close the database connection.
 */
function close() {
    if (recipeDB) {
        recipeDB.close((err) => {
            if (err) {
                logger.error('recipe-storage close error: ' + err);
            }
        });
    }
}

module.exports = {
    init,
    getRecipeData,
    setRecipeData,
    getAllRecipes,
    deleteRecipeData,
    close
};
