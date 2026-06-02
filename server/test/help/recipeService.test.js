/**
 * Tests for recipe-service type coercion logic.
 *
 * coerceValue is a pure function — no mocking needed.
 */

const recipeService = require('../../runtime/recipes/recipe-service');

describe('Recipe Service - coerceValue', () => {
    let expect;
    let sinon;

    before(async () => {
        const chai = await import('chai');
        sinon = await import('sinon');
        expect = chai.expect;
    });

    // -----------------------------------------------------------------------
    // Boolean types
    // -----------------------------------------------------------------------
    describe('Boolean types', () => {
        it('should coerce "true" string to boolean true for Bool', () => {
            expect(recipeService.coerceValue('true', 'Bool')).to.equal(true);
        });

        it('should coerce "1" string to boolean true for Boolean', () => {
            expect(recipeService.coerceValue('1', 'Boolean')).to.equal(true);
        });

        it('should coerce "false" string to boolean false for Bool', () => {
            expect(recipeService.coerceValue('false', 'Bool')).to.equal(false);
        });

        it('should coerce "0" string to boolean false for Boolean', () => {
            expect(recipeService.coerceValue('0', 'Boolean')).to.equal(false);
        });

        it('should pass through boolean primitives unchanged', () => {
            expect(recipeService.coerceValue(true, 'Bool')).to.equal(true);
            expect(recipeService.coerceValue(false, 'Bool')).to.equal(false);
        });
    });

    // -----------------------------------------------------------------------
    // Integer types
    // -----------------------------------------------------------------------
    describe('Integer types (Int, DInt, Int16, Int32, number)', () => {
        it('should coerce "42" to integer 42 for Int', () => {
            expect(recipeService.coerceValue('42', 'Int')).to.equal(42);
        });

        it('should coerce "-10" to integer -10 for DInt', () => {
            expect(recipeService.coerceValue('-10', 'DInt')).to.equal(-10);
        });

        it('should handle Int16 type', () => {
            expect(recipeService.coerceValue('100', 'Int16')).to.equal(100);
        });

        it('should handle Int32 type', () => {
            expect(recipeService.coerceValue('200', 'Int32')).to.equal(200);
        });

        it('should return the original string when value is not parseable', () => {
            expect(recipeService.coerceValue('abc', 'Int')).to.equal('abc');
        });

        it('should handle "number" tagType', () => {
            expect(recipeService.coerceValue('99', 'number')).to.equal(99);
        });
    });

    // -----------------------------------------------------------------------
    // Float / Real types
    // -----------------------------------------------------------------------
    describe('Float / Real / Double types', () => {
        it('should coerce "3.14" to float 3.14 for Real', () => {
            expect(recipeService.coerceValue('3.14', 'Real')).to.equal(3.14);
        });

        it('should coerce "2.5" to float 2.5 for Float', () => {
            expect(recipeService.coerceValue('2.5', 'Float')).to.equal(2.5);
        });

        it('should coerce "1.5" for Double', () => {
            expect(recipeService.coerceValue('1.5', 'Double')).to.equal(1.5);
        });

        it('should return the original string when value is not parseable', () => {
            expect(recipeService.coerceValue('not-a-number', 'Real')).to.equal('not-a-number');
        });
    });

    // -----------------------------------------------------------------------
    // Byte type
    // -----------------------------------------------------------------------
    describe('Byte type (clamped 0–255)', () => {
        it('should coerce "128" to 128', () => {
            expect(recipeService.coerceValue('128', 'Byte')).to.equal(128);
        });

        it('should clamp 300 to 255', () => {
            expect(recipeService.coerceValue('300', 'Byte')).to.equal(255);
        });

        it('should clamp -10 to 0', () => {
            expect(recipeService.coerceValue('-10', 'Byte')).to.equal(0);
        });

        it('should return the original string when value is not parseable', () => {
            expect(recipeService.coerceValue('abc', 'Byte')).to.equal('abc');
        });
    });

    // -----------------------------------------------------------------------
    // String / Word types
    // -----------------------------------------------------------------------
    describe('String / Word types (pass-through)', () => {
        it('should pass through string values unchanged for String type', () => {
            expect(recipeService.coerceValue('hello', 'String')).to.equal('hello');
        });

        it('should pass through string values unchanged for Word type', () => {
            expect(recipeService.coerceValue('world', 'Word')).to.equal('world');
        });
    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------
    describe('Edge cases', () => {
        it('should return undefined for undefined value', () => {
            expect(recipeService.coerceValue(undefined, 'Int')).to.equal(undefined);
        });

        it('should return null for null value', () => {
            expect(recipeService.coerceValue(null, 'String')).to.equal(null);
        });

        it('should pass through value unchanged for empty tagType', () => {
            expect(recipeService.coerceValue('test', '')).to.equal('test');
        });
    });
});
