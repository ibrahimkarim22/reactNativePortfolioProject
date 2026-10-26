const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseDocument } = require('htmlparser2');

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
}

function parseRoot(html) {
  const document = parseDocument(html, { decodeEntities: true });
  let root;
  walk(document, node => {
    if (node.nodeType === 1) {
      node.getAttribute = name => Object.hasOwn(node.attribs, name) ? node.attribs[name] : null;
      if (node.name === 'main') root = node;
    }
  });
  assert.ok(root, 'fixture contains the generated main root');
  return root;
}

function factory() {
  const file = path.resolve(__dirname, '../../reader/readerSelectionDom.js');
  const exported = fs.existsSync(file) ? require(file) : {};
  assert.equal(typeof exported.SELECTION_DOM_SOURCE, 'string', 'fixed DOM selection source exists');
  const create = vm.runInNewContext(`${exported.SELECTION_DOM_SOURCE}\ncreateSelectionDom;`);
  assert.equal(typeof create, 'function');
  return create;
}

function selection(startContainer, startOffset, endContainer, endOffset, backward = false) {
  return {
    rangeCount: 1,
    isCollapsed: startContainer === endContainer && startOffset === endOffset,
    anchorNode: backward ? endContainer : startContainer,
    anchorOffset: backward ? endOffset : startOffset,
    focusNode: backward ? startContainer : endContainer,
    focusOffset: backward ? startOffset : endOffset,
    toString() { throw new Error('Selection text is never an authority'); },
    getRangeAt(index) {
      assert.equal(index, 0);
      return { startContainer, startOffset, endContainer, endOffset,
        collapsed: startContainer === endContainer && startOffset === endOffset,
        toString() { throw new Error('Range text is never an authority'); } };
    },
  };
}

function textNodes(node) {
  const result = [];
  walk(node, child => { if (child.nodeType === 3) result.push(child); });
  return result;
}

function point(block, offset, isEnd = false) {
  const nodes = textNodes(block);
  let preceding = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const next = preceding + node.data.length;
    if (offset < next || (offset === next && (isEnd || index === nodes.length - 1))) return [node, offset - preceding];
    preceding = next;
  }
  assert.equal(offset, 0, 'only empty blocks have no text-node endpoint');
  return [block, 0];
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

module.exports = { factory, parseRoot, selection, textNodes, point, plain, walk };
