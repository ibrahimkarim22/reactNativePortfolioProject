const assert = require('node:assert/strict');
const test = require('node:test');
const fixture = require('../fixtures/synopsisFixture.cjs');
const content = () => require('../../shared/synopsisContent');

test('structured synopsis validation resolves edition-bound evidence and orders the actual framing and acts', () => {
  const entry = fixture();
  assert.deepEqual(content().validateSynopsisContent(entry.synopsis, entry).errors, []);
  assert.deepEqual(content().orderedSynopsisSections(entry.synopsis, entry.play).map(item => item.label), ['Prologue', 'ACT I', 'Epilogue']);
});

test('synopsis validation rejects missing acts, foreign references, stale versions, empty prose and fabricated scenes', () => {
  for (const mutate of [
    synopsis => { synopsis.acts = []; },
    synopsis => { synopsis.fullSynopsis[0].evidence[0].workId = 'other-play'; },
    synopsis => { synopsis.fullSynopsis[0].id = 'other-play-summary-01'; },
    synopsis => { synopsis.contentVersion = 'other-edition'; },
    synopsis => { synopsis.fullSynopsis[0].evidence[0].sectionId = 'not-a-section'; },
    synopsis => { synopsis.introduction = ''; },
    synopsis => { synopsis.framing.pop(); },
    synopsis => { synopsis.scenes.push({ summary: 'Invented scene.' }); },
    synopsis => { synopsis.synopsisContentVersion = ''; },
  ]) {
    const entry = fixture(); mutate(entry.synopsis);
    assert.ok(content().validateSynopsisContent(entry.synopsis, entry).errors.length > 0);
  }
});

test('reference validation does not certify the factual meaning of authored prose', () => {
  const entry = fixture();
  entry.synopsis.fullSynopsis[0].text = 'A claim requiring separate editorial review.';
  assert.deepEqual(content().validateSynopsisContent(entry.synopsis, entry).errors, [],
    'valid references prove structure and identity, not the truth of paraphrased claims');
});

test('a framing summary can cite its continuation inside an act without omitting the actual framing section', () => {
  const entry = fixture();
  entry.synopsis.framing[0].evidence.push(entry.synopsis.acts[0].evidence[0]);
  assert.deepEqual(content().validateSynopsisContent(entry.synopsis, entry).errors, []);
  entry.synopsis.framing[0].evidence.shift();
  assert.ok(content().validateSynopsisContent(entry.synopsis, entry).errors.length > 0,
    'an unrelated scene cannot stand in for the framing source itself');
});

test('HTML compatibility rendering escapes prose and preserves paragraphs and separate spoiler sections', () => {
  const entry = fixture();
  entry.synopsis.fullSynopsis.push({ ...entry.synopsis.fullSynopsis[0], id: 'second', text: '<img src=x> & an ending.' });
  const html = content().renderSynopsisHtml(entry.synopsis, 'Title < & >');
  assert.match(html, /Title &lt; &amp; &gt;/);
  assert.match(html, /&lt;img src=x&gt; &amp; an ending\./);
  assert.doesNotMatch(html, /<img/);
  assert.equal((html.match(/<h1>/g) || []).length, 1);
  assert.ok(html.includes('Plot spoilers'));
  assert.ok(html.includes('</p><p>'));
});

test('every catalogue work has a complete, distinct source-linked synopsis package', () => {
  const result = require('../../scripts/validateSynopsisCollection.cjs').validateSynopsisCollection();
  assert.equal(result.plays.length, 38);
  assert.deepEqual(result.errors, []);
});
