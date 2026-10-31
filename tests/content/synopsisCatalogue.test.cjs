const assert = require('node:assert/strict');
const test = require('node:test');
const { synopsisUIHost, nodes, text } = require('../fixtures/synopsisUIHost.cjs');
const catalogue = () => require('../../shared/synopsisCatalogue');

test('title and existing alias search combine with genre filters and preserve source metadata', () => {
  const plays = [
    { id: 'macbeth', name: 'The Scottish Play', title: 'The Tragedy of Macbeth', genre: 'Tragedy', aliases: ['Mac'] },
    { id: 'dream', name: "A Midsummer Night's Dream", genre: 'Comedy' },
    { id: 'henry', name: 'Henry IV, Part 1', genre: 'History', aliases: ['1H4'] },
  ];
  const snapshot = JSON.stringify(plays);
  assert.deepEqual(catalogue().filterSynopsisPlays(plays, '', 'All').map(p => p.id), ['dream', 'henry', 'macbeth']);
  assert.deepEqual(catalogue().filterSynopsisPlays(plays, 'MACBETH', 'Tragedy').map(p => p.id), ['macbeth']);
  assert.deepEqual(catalogue().filterSynopsisPlays(plays, 'macbeth', 'Comedy'), []);
  assert.deepEqual(catalogue().filterSynopsisPlays(plays, 'midsummer night’s', 'All').map(p => p.id), ['dream']);
  assert.deepEqual(catalogue().filterSynopsisPlays(plays, '1h4', 'History').map(p => p.id), ['henry']);
  assert.equal(JSON.stringify(plays), snapshot);
});

test('the catalogue shows covers, readable neutral rows and searchable genre combinations without medal images', () => {
  const plays = [
    { id: 'b', name: 'Play B', genre: 'Tragedy', mainImage: 'cover-b', medalImage: 'medal-b' },
    { id: 'a', name: 'Play A', genre: 'Comedy', mainImage: 'cover-a', medalImage: 'medal-a' },
  ];
  const h = synopsisUIHost({ screen: 'screens/SynopsisList.js', plays });
  assert.deepEqual(nodes(h.render(), 'Image').map(n => n.props.source), ['cover-a', 'cover-b']);
  h.button('Tragedy').props.onPress();
  nodes(h.render(), 'TextInput')[0].props.onChangeText('play b');
  assert.equal(h.button('Play A synopsis'), undefined);
  h.button('Play B synopsis').props.onPress();
  assert.deepEqual(h.calls.filter(c => c[0] === 'Synopsis'), [['Synopsis', { id: 'b' }]]);
  assert.equal(nodes(h.render(), 'TextInput')[0].props.value, 'play b');
  assert.equal(h.button('Tragedy').props.accessibilityState.selected, true);
  nodes(h.render(), 'TextInput')[0].props.onChangeText('absent');
  assert.match(text(h.render()), /No plays found/);
  h.button('Clear search').props.onPress();
  assert.equal(nodes(h.render(), 'TextInput')[0].props.value, '');
  assert.equal(h.button('Play B synopsis') !== undefined, true);
  nodes(h.render(), 'TextInput')[0].props.onSubmitEditing();
  assert.ok(h.calls.some(c => c[0] === 'keyboard-dismiss'));
  assert.equal(nodes(h.render(), 'ScrollView').length, 1);
  assert.equal(nodes(h.render(), 'ScrollView')[0].props.keyboardDismissMode, 'on-drag');
});
