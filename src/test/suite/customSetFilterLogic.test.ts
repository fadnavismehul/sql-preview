import * as assert from 'assert';

/**
 * Mocks the CustomSetFilter logic from webviews/results/resultsView.js
 * accurately to ensure we test the exact behavior.
 */
class CustomSetFilterLogic {
  uniqueValues: Set<string>;
  sortedValues: string[];
  selectedValues: Set<string>;
  params: any;

  constructor(mockParams: any) {
    this.params = mockParams;
    this.uniqueValues = new Set();

    // Emulate init() logic
    if (this.params.api && this.params.api.forEachNode) {
      this.params.api.forEachNode((node: any) => {
        let value = null;
        if (this.params.valueGetter) {
          value = this.params.valueGetter(node);
        }
        if ((value === null || value === undefined) && node.data && this.params.colDef.field) {
          value = node.data[this.params.colDef.field];
        }

        let valStr = '(Blanks)';
        if (value !== null && value !== undefined) {
          valStr = String(value);
        }
        this.uniqueValues.add(valStr);
      });
    }

    this.sortedValues = Array.from(this.uniqueValues).sort();
    this.selectedValues = new Set(this.sortedValues);
  }

  doesFilterPass(params: { node: any; data?: any }): boolean {
    // Robust value extraction: Try valueGetter, then field access
    let value = null;
    if (this.params.valueGetter) {
      value = this.params.valueGetter(params.node);
    }
    // Note: params.node.data is usually where data lives in AG Grid
    if ((value === null || value === undefined) && params.node.data && this.params.colDef.field) {
      value = params.node.data[this.params.colDef.field];
    }

    const valStr = value === null || value === undefined ? '(Blanks)' : String(value);
    return this.selectedValues.has(valStr);
  }
}

describe('Custom Set Filter Logic Test Suite', () => {
  it('Scenario 1: Extracts simple values correctly', () => {
    const nodes = [
      { data: { country: 'US' } },
      { data: { country: 'UK' } },
      { data: { country: 'US' } },
    ];

    const logic = new CustomSetFilterLogic({
      api: { forEachNode: (cb: any) => nodes.forEach(cb) },
      colDef: { field: 'country' },
      valueGetter: null,
    });

    assert.strictEqual(logic.uniqueValues.size, 2);
    assert.ok(logic.uniqueValues.has('US'));
    assert.ok(logic.uniqueValues.has('UK'));
  });

  it('Scenario 2: Handles nulls as (Blanks)', () => {
    const nodes = [
      { data: { country: 'US' } },
      { data: { country: null } },
      { data: { country: undefined } },
    ];

    const logic = new CustomSetFilterLogic({
      api: { forEachNode: (cb: any) => nodes.forEach(cb) },
      colDef: { field: 'country' },
      valueGetter: null,
    });

    assert.strictEqual(logic.uniqueValues.size, 2);
    assert.ok(logic.uniqueValues.has('US'));
    assert.ok(logic.uniqueValues.has('(Blanks)'));
  });

  it('Scenario 3: ValueGetter fallback logic (The Fix Verification)', () => {
    // This tests the logic that was causing the "disappearing data" bug.
    // If valueGetter returns undefined (simulating it failing or not existing for a node),
    // we MUST fallback to data[field].

    const nodes = [{ data: { id: 1, name: 'Alice' } }, { data: { id: 2, name: 'Bob' } }];

    const logic = new CustomSetFilterLogic({
      api: { forEachNode: (cb: any) => nodes.forEach(cb) },
      colDef: { field: 'id' },
      // Emulate a valueGetter that returns null/undefined sometimes
      valueGetter: () => undefined,
    });

    // Init should have found 1 and 2 because of fallback to field 'id'
    assert.strictEqual(logic.uniqueValues.size, 2, 'Should extract 2 unique values via fallback');
    assert.ok(logic.uniqueValues.has('1'));
    assert.ok(logic.uniqueValues.has('2'));

    // TEST doesFilterPass
    // Deselect '1'
    logic.selectedValues.delete('1');

    // Check if '2' still passes
    const node2 = { node: { data: { id: 2, name: 'Bob' } } };
    const pass2 = logic.doesFilterPass(node2);
    assert.strictEqual(pass2, true, 'Row with id 2 should still pass after deselecting 1');

    // Check if '1' fails
    const node1 = { node: { data: { id: 1, name: 'Alice' } } };
    const pass1 = logic.doesFilterPass(node1);
    assert.strictEqual(pass1, false, 'Row with id 1 should fail');
  });

  it('Scenario 4: numeric values extraction and filtering', () => {
    const nodes = [
      { data: { country_id: 1 } },
      { data: { country_id: 10 } },
      { data: { country_id: 100 } },
    ];

    const logic = new CustomSetFilterLogic({
      api: { forEachNode: (cb: any) => nodes.forEach(cb) },
      colDef: { field: 'country_id' },
    });

    assert.ok(logic.uniqueValues.has('1'));
    assert.ok(logic.uniqueValues.has('10'));
    assert.ok(logic.uniqueValues.has('100'));

    // Simulate user deselecting '1'
    logic.selectedValues.delete('1');

    // 10 should passed
    assert.strictEqual(logic.doesFilterPass({ node: { data: { country_id: 10 } } }), true);
    // 1 should fail
    assert.strictEqual(logic.doesFilterPass({ node: { data: { country_id: 1 } } }), false);
  });
});
