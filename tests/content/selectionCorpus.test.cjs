const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { parseSource } = require('../../scripts/parseGutenberg');
const { buildCanonicalDocument, createSelection, resolveSelection,
  createSectionReference, resolveSectionReference } = require('../../shared/contentText');

test('real-source selections and section bookmarks round trip for all 38 plays', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../data/source/pg100-images.html'), 'utf8');
  const parsed = parseSource(source);
  assert.equal(parsed.plays.length, 38);
  for (const entry of parsed.plays) {
    const document = buildCanonicalDocument(entry);
    const first = document.units[0];
    const following = document.units.find((unit) => unit.sectionId !== first.sectionId && unit.textEnd > unit.start);
    assert.ok(following, `${document.workId}: cross-section target`);
    const start = first.start + 1;
    const end = Math.min(following.textEnd, following.start + 7);
    const selection = createSelection(document, start, end);
    assert.equal(resolveSelection(document, selection).text, document.text.slice(start, end));
    assert.notEqual(selection.startRef.sectionId, selection.endRef.sectionId);
    const section = document.sections.find((item) => item.id === following.sectionId);
    const bookmark = createSectionReference(document, section.id);
    assert.equal(resolveSectionReference(document, bookmark).text, document.text.slice(section.start, section.end));
    assert.throws(() => resolveSelection({ ...document, contentVersion: 'another-generated-revision' }, selection),
      { code: 'CONTENT_VERSION_MISMATCH' });
  }
});
