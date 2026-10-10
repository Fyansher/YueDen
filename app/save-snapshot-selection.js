(function(root) {
'use strict';

function normalizeIds(values) {
  return values instanceof Set ? values : new Set(Array.isArray(values) ? values : []);
}

function hasRows(resourceIds = [], snapshotIds = []) {
  return resourceIds.length > 0 || snapshotIds.length > 0;
}

function allSelected(resourceIds = [], snapshotIds = [], selectedResourceIds = [], selectedSnapshotIds = []) {
  const resources = normalizeIds(selectedResourceIds), snapshots = normalizeIds(selectedSnapshotIds);
  return hasRows(resourceIds, snapshotIds)
    && resourceIds.every(id => resources.has(id))
    && snapshotIds.every(id => snapshots.has(id));
}

function toggleAll(resourceIds = [], snapshotIds = [], selectedResourceIds = [], selectedSnapshotIds = []) {
  const clear = allSelected(resourceIds, snapshotIds, selectedResourceIds, selectedSnapshotIds);
  return {
    resourceIds: clear ? [] : [...resourceIds],
    snapshotIds: clear ? [] : [...snapshotIds],
    clear
  };
}

function toggleSnapshots(snapshotIds = [], selectedSnapshotIds = []) {
  const selected = new Set(normalizeIds(selectedSnapshotIds));
  const clear = snapshotIds.length > 0 && snapshotIds.every(id => selected.has(id));
  for (const id of snapshotIds) clear ? selected.delete(id) : selected.add(id);
  return { snapshotIds: [...selected], clear };
}

function isWithinGroupControlHitArea(control, clientX, clientY) {
  const rect = control?.getBoundingClientRect?.();
  if (!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  return clientX >= rect.left - 12 && clientX <= rect.right + 2
    && clientY >= rect.top - 7 && clientY <= rect.bottom + 7;
}

function isSnapshotPanelControlTarget(target) {
  return Boolean(target?.closest?.('.card-save-snapshots button, .card-save-snapshots input, .card-save-snapshots select, .card-save-snapshots a, .card-save-snapshots .snapshot-row-select'));
}

function shouldSelectSnapshotFromRow(selectionEnabled, target) {
  return Boolean(selectionEnabled && !target?.closest?.('.snapshot-row-select, button, input, select, a'));
}

function bindGroupControl(control, getSnapshotIds, getSelectedSnapshotIds, onChange) {
  control.onpointerdown = event => {
    if (event.button === 0) event.stopPropagation();
  };
  control.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    onChange(toggleSnapshots(getSnapshotIds(), getSelectedSnapshotIds()));
  };
  return control;
}

function planDeletion({ resourceIds = [], localSnapshots = [], visibleSnapshots = [], selectedSnapshots = [] } = {}) {
  const resources = new Set([...resourceIds].map(String));
  const explicit = new Map();
  for (const row of selectedSnapshots || []) {
    const id = String(row?.id || '');
    if (id && !explicit.has(id)) explicit.set(id, row);
  }
  const explicitIds = new Set(explicit.keys()), related = new Map();
  for (const row of [...(localSnapshots || []), ...(visibleSnapshots || [])]) {
    const id = String(row?.id || '');
    if (id && !related.has(id)) related.set(id, row);
  }
  const additional = [...related.values()].filter(row => resources.has(String(row.itemId || '')) && !explicitIds.has(String(row.id || '')));
  return { explicit: [...explicit.values()], additional };
}

const api = { hasRows, allSelected, toggleAll, toggleSnapshots, isWithinGroupControlHitArea, isSnapshotPanelControlTarget, shouldSelectSnapshotFromRow, bindGroupControl, planDeletion };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.SaveSnapshotSelection = api;
})(typeof window !== 'undefined' ? window : globalThis);
