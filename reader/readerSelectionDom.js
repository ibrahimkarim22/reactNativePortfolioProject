// Application-owned source is composed directly into the WebView runtime. Keep
// the adapter dependency-free; tests execute this identical source in a VM.
const SELECTION_DOM_SOURCE = String.raw`
function createSelectionDom(root, identity) {
  'use strict';
  const MAX_CAPTURE = 16384;
  const MAPPING_ATTRIBUTES = ['data-reader-block', 'data-text-id', 'data-section-id', 'data-start', 'data-text-end', 'data-end', 'data-separator'];
  function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
  function invalid() { fail('INVALID_MAPPING', 'The reading document no longer has an exact canonical DOM mapping.'); }
  function boundedString(value) { return typeof value === 'string' && value.length > 0 && value.length <= 512; }
  if (!root || root.nodeType !== 1 || String(root.tagName).toLowerCase() !== 'main'
      || !identity || !boundedString(identity.workId) || !boundedString(identity.contentVersion)
      || identity.canonicalTextVersion !== '1') invalid();
  const workId = identity.workId;
  const contentVersion = identity.contentVersion;
  const canonicalTextVersion = identity.canonicalTextVersion;
  const positions = new Map();
  const snapshots = [];
  const units = [];
  const ids = new Set();
  const completedSections = new Set();
  let lastSection = null;
  const pieces = [];
  function attribute(node, name) {
    if (typeof node.getAttribute !== 'function') invalid();
    return node.getAttribute(name);
  }
  function children(node) {
    if (!node.childNodes || !Number.isSafeInteger(node.childNodes.length)) invalid();
    return Array.prototype.slice.call(node.childNodes);
  }
  function remember(node, start, parent, isBlock) {
    if (positions.has(node) || node.parentNode !== parent) invalid();
    const type = node.nodeType;
    if (type !== 1 && type !== 3) invalid();
    const record = { node: node, type: type, parent: parent, start: start, childOffsets: [start] };
    if (type === 3) {
      if (typeof node.data !== 'string') invalid();
      record.data = node.data;
      record.end = start + node.data.length;
      record.children = [];
      pieces.push(node.data);
    } else {
      record.tagName = node.tagName;
      record.attributes = MAPPING_ATTRIBUTES.map(function(name) { return attribute(node, name); });
      if (!isBlock && record.attributes.some(function(value) { return value !== null; })) invalid();
      record.children = children(node);
      let offset = start;
      record.children.forEach(function(child) {
        offset = remember(child, offset, node, false).end;
        record.childOffsets.push(offset);
      });
      record.end = offset;
    }
    positions.set(node, record);
    snapshots.push(record);
    return record;
  }
  function integerAttribute(node, name) {
    const value = attribute(node, name);
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) invalid();
    const number = Number(value);
    if (!Number.isSafeInteger(number)) invalid();
    return number;
  }
  const blockNodes = children(root);
  if (!blockNodes.length || MAPPING_ATTRIBUTES.some(function(name) { return attribute(root, name) !== null; })) invalid();
  const rootRecord = { node: root, type: 1, parent: root.parentNode, tagName: root.tagName,
    attributes: MAPPING_ATTRIBUTES.map(function(name) { return attribute(root, name); }),
    children: blockNodes, start: 0, childOffsets: [0] };
  let cursor = 0;
  blockNodes.forEach(function(block, index) {
    if (block.nodeType !== 1 || attribute(block, 'data-reader-block') !== 'true') invalid();
    const id = attribute(block, 'data-text-id');
    const sectionId = attribute(block, 'data-section-id');
    const separator = attribute(block, 'data-separator');
    const start = integerAttribute(block, 'data-start');
    const textEnd = integerAttribute(block, 'data-text-end');
    const end = integerAttribute(block, 'data-end');
    if (!boundedString(id) || !boundedString(sectionId) || ids.has(id) || typeof separator !== 'string'
        || start !== cursor || textEnd < start || end < textEnd || separator.length !== end - textEnd
        || (index === blockNodes.length - 1 && separator !== '')) invalid();
    if (sectionId !== lastSection) {
      if (completedSections.has(sectionId)) invalid();
      if (lastSection !== null) completedSections.add(lastSection);
      lastSection = sectionId;
    }
    ids.add(id);
    const record = remember(block, start, root, true);
    if (record.end !== textEnd) invalid();
    pieces.push(separator);
    units.push({ id: id, sectionId: sectionId, start: start, textEnd: textEnd, end: end });
    cursor = end;
    rootRecord.childOffsets.push(cursor);
  });
  rootRecord.end = cursor;
  positions.set(root, rootRecord);
  snapshots.push(rootRecord);
  const text = pieces.join('');
  if (text.length !== cursor) invalid();

  // Recheck node identity as well as values: text splitting, equal-text node
  // replacement, reparenting and reordered inline nodes all invalidate the index.
  function validateIndex() {
    snapshots.forEach(function(record) {
      const node = record.node;
      if (node.nodeType !== record.type || node.parentNode !== record.parent) invalid();
      if (record.type === 3) {
        if (node.data !== record.data) invalid();
      } else {
        if (node.tagName !== record.tagName) invalid();
        for (let i = 0; i < MAPPING_ATTRIBUTES.length; i += 1) {
          if (attribute(node, MAPPING_ATTRIBUTES[i]) !== record.attributes[i]) invalid();
        }
        const current = node.childNodes;
        if (!current || current.length !== record.children.length) invalid();
        for (let child = 0; child < current.length; child += 1) {
          if (current[child] !== record.children[child]) invalid();
        }
      }
    });
  }
  function endpoint(node, offset) {
    const record = positions.get(node);
    if (!record) fail('OUTSIDE_ROOT', 'Both selection endpoints must belong to the reading root.');
    const limit = record.type === 3 ? record.data.length : record.children.length;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > limit) {
      fail('INVALID_RANGE', 'A DOM endpoint must be an exact UTF-16 or child-node boundary.');
    }
    return record.type === 3 ? record.start + offset : record.childOffsets[offset];
  }
  function splitsSurrogate(offset) {
    const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
    return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
  }
  function reference(offset, isEnd) {
    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index];
      if (isEnd ? offset > unit.start && offset <= unit.end : offset >= unit.start && offset < unit.end) {
        return { textId: unit.id, sectionId: unit.sectionId, offsetUtf16: offset - unit.start };
      }
    }
    invalid();
  }
  function read(selection) {
    validateIndex();
    if (!selection || selection.rangeCount !== 1 || typeof selection.getRangeAt !== 'function') {
      fail('INVALID_SELECTION', 'One live native selection range is required.');
    }
    let range;
    try { range = selection.getRangeAt(0); }
    catch (_) { fail('INVALID_SELECTION', 'The live selection range is unavailable.'); }
    if (!range) fail('INVALID_SELECTION', 'The live selection range is unavailable.');
    // getRangeAt is already normalized for forward and backward selections.
    // Neither Selection.toString nor Range.toString participates in capture.
    const start = endpoint(range.startContainer, range.startOffset);
    const end = endpoint(range.endContainer, range.endOffset);
    if (range.collapsed || start === end) fail('COLLAPSED_SELECTION', 'A nonempty selection is required.');
    if (start > end) fail('INVALID_RANGE', 'The live range must be in canonical document order.');
    if (splitsSurrogate(start) || splitsSurrogate(end)) {
      fail('SURROGATE_BOUNDARY', 'A selection endpoint cannot divide a UTF-16 surrogate pair.');
    }
    if (end - start > MAX_CAPTURE) fail('SELECTION_TOO_LARGE', 'The selection exceeds 16,384 UTF-16 units.');
    let prefixStart = Math.max(0, start - 32), suffixEnd = Math.min(text.length, end + 32);
    if (splitsSurrogate(prefixStart)) prefixStart += 1;
    if (splitsSurrogate(suffixEnd)) suffixEnd -= 1;
    return { kind: 'text-range', workId: workId, contentVersion: contentVersion, canonicalTextVersion: canonicalTextVersion,
      offsetUnit: 'utf16', start: start, end: end, startRef: reference(start, false), endRef: reference(end, true),
      exact: text.slice(start, end), prefix: text.slice(prefixStart, start), suffix: text.slice(end, suffixEnd) };
  }
  return { read: read };
}
`;

module.exports = { SELECTION_DOM_SOURCE };
