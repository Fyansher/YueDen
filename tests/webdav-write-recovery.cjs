const test = require('node:test');
const assert = require('node:assert/strict');
const { classifySyncStateWrite } = require('../app/webdav-write-recovery');

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

test('confirms a PUT whose response was lost when the cloud now contains the full intended state', () => {
  const before = { items: [{ id: 'resource', name: 'Before' }] };
  const expected = { items: [{ id: 'resource', name: 'After' }] };
  assert.equal(classifySyncStateWrite({ expected, before, after: expected, same }), 'confirmed');
});

test('does not report success when the cloud stayed at its pre-write state', () => {
  const before = { items: [{ id: 'resource', name: 'Before' }] };
  const expected = { items: [{ id: 'resource', name: 'After' }] };
  assert.equal(classifySyncStateWrite({ expected, before, after: before, same }), 'unchanged');
});

test('leaves a changed cloud state for the existing conflict decision flow', () => {
  const before = { items: [{ id: 'resource', name: 'Before' }] };
  const expected = { items: [{ id: 'resource', name: 'Local' }] };
  const after = { items: [{ id: 'resource', name: 'Other device' }] };
  assert.equal(classifySyncStateWrite({ expected, before, after, same }), 'changed');
});
