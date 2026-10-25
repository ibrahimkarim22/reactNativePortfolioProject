const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
function presentation() {
  assert.ok(fs.existsSync(require('node:path').resolve(__dirname, '../../reader/myHighlightsPresentation.js')), 'production My Highlights presentation model exists');
  return require('../../reader/myHighlightsPresentation');
}
test('overview uses catalogue titles, alphabetical nonempty works and honest retained-entry counts', () => {
  const { catalogueRows } = presentation();
  const rows = catalogueRows([{ workKey: 'hamlet', workId: 'hamlet', count: 2 }, { workKey: 'zero', workId: 'zero', count: 0 }, { workKey: 'unknown', workId: 'unknown', count: 1 }, { workKey: 'alls-well', workId: 'alls-well', count: 3 }], [{ id: 'hamlet', name: 'Hamlet' }, { id: 'alls-well', name: 'All’s Well That Ends Well' }]);
  assert.deepEqual(rows.map(r => r.title), ['All’s Well That Ends Well', 'Hamlet', 'Unavailable play']);
  assert.equal(rows[1].count, 2);
  assert.match(rows[1].countLabel, /2 saved entries/);
  assert.equal(rows[2].available, false);
  assert.equal(rows[2].workKey, 'unknown');
});
test('detail preserves exact quotes, source order and unavailable rows without quote matching', () => {
  const { highlightRows } = presentation();
  const record = (id, start, end, sectionId, exact = 'Repeated quotation') => ({ id, colorId: 'sage', revision: 1, selectionRef: { start, end, startRef: { sectionId }, exact } });
  const snapshot = { records: [record('late', 50, 60, 'epilogue'), record('same-long', 10, 20, 'prologue'), record('same-short', 10, 15, 'prologue')], unresolved: [{ record: record('old', 3, 9, 'gone') }], unreadable: [{ id: 'broken', code: 'INVALID_HIGHLIGHT' }], conflicts: ['same-long'] };
  const rows = highlightRows(snapshot, { items: [{ id: 'prologue', locationLabel: 'Prologue' }, { id: 'epilogue', locationLabel: 'Epilogue' }] });
  assert.deepEqual(rows.map(r => r.id), ['old', 'same-short', 'same-long', 'late', 'broken']);
  assert.equal(rows[1].quotation, 'Repeated quotation');
  assert.equal(rows[1].locationLabel, 'Prologue');
  assert.equal(rows[3].locationLabel, 'Epilogue');
  assert.equal(rows[0].status, 'unresolved');
  assert.equal(rows[2].status, 'conflict');
  assert.equal(rows[4].status, 'unreadable');
});
test('bounded previews never alter stored quotations or split a surrogate pair', () => {
  const { previewQuote } = presentation();
  const exact = 'A'.repeat(239) + '😀' + '\nSECOND PARAGRAPH';
  const preview = previewQuote(exact);
  assert.ok(preview.length <= 241);
  assert.equal(preview, 'A'.repeat(239) + '…');
  assert.equal(exact.slice(239), '😀\nSECOND PARAGRAPH');
  assert.equal(previewQuote('FIRST.\nThe exact passage.'), 'FIRST.\nThe exact passage.');
});

test('sync rows retain deletion conflicts without treating them as active overlap highlights', () => {
  const record={id:'deleted',colorId:'yellow',selectionRef:{start:2,end:7,startRef:{sectionId:'s'},exact:'Exact'}};
  const snapshot={records:[],tombstones:[{id:'deleted',record}],syncById:{deleted:{status:'conflict',conflict:{cloud:{deleted:false}}}}};
  const rows=presentation().highlightRows(snapshot,{items:[{id:'s',locationLabel:'Act I'}]});
  assert.equal(rows.length,1);assert.equal(rows[0].quotation,'Exact');assert.equal(rows[0].retainedDeletion,true);assert.equal(rows[0].syncConflict,true);assert.equal(rows[0].overlapConflict,false);assert.equal(rows[0].status,'conflict');
  const deleted=presentation().highlightRows({records:[record],syncById:{deleted:{status:'conflict',conflict:{cloud:{deleted:true}}}}});
  assert.equal(deleted[0].syncDeletion,true);assert.equal(deleted[0].syncConflict,true);
});

test('catalogue uses the measured local and remote description instead of a guessed merged count',()=>{
  const rows=presentation().catalogueRows([{workKey:'hamlet',workId:'hamlet',count:4,countDescription:'2 on this device; 4 last confirmed remotely'}],[{id:'hamlet',name:'Hamlet'}]);
  assert.equal(rows[0].countLabel,'2 on this device; 4 last confirmed remotely');
});
