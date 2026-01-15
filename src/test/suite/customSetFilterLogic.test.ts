import * as assert from 'assert';

// Mock the class structure for testing logic to ensure robustness
class CustomSetFilterLogic {
  uniqueValues: Set<string>;
  sortedValues: string[];
  selectedValues: Set<string>;

  constructor(mockNodes: any[], field: string) {
    this.uniqueValues = new Set();
    mockNodes.forEach(node => {
      // Mimic the logic in resultsView.js
      let value = null;
      // skipping valueGetter logic as we are testing data extraction safety
      if (node.data && field) {
        value = node.data[field];
      }
      const valStr = value === null || value === undefined ? '(Blanks)' : String(value);
      this.uniqueValues.add(valStr);
    });
    this.sortedValues = Array.from(this.uniqueValues).sort();
    this.selectedValues = new Set(this.sortedValues);
  }

  doesFilterPass(nodeData: any, field: string): boolean {
    const value = nodeData[field];
    const valStr = value === null || value === undefined ? '(Blanks)' : String(value);
    return this.selectedValues.has(valStr);
  }
}

describe('Custom Set Filter Logic Test Suite', () => {
  it('Extracts unique values correctly', () => {
    const nodes = [
      { data: { country: 'US' } },
      { data: { country: 'UK' } },
      { data: { country: 'US' } },
      { data: { country: null } },
    ];

    const filter = new CustomSetFilterLogic(nodes, 'country');
    assert.strictEqual(filter.uniqueValues.size, 3);
    assert.ok(filter.uniqueValues.has('US'));
    assert.ok(filter.uniqueValues.has('UK'));
    assert.ok(filter.uniqueValues.has('(Blanks)'));
  });

  it('Filters rows correctly', () => {
    const nodes = [{ data: { country: 'US' } }, { data: { country: 'UK' } }];
    const filter = new CustomSetFilterLogic(nodes, 'country');

    // Unselect UK
    filter.selectedValues.delete('UK');

    assert.strictEqual(filter.doesFilterPass({ country: 'US' }, 'country'), true);
    assert.strictEqual(filter.doesFilterPass({ country: 'UK' }, 'country'), false);
  });
});
