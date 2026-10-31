const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { synopsisUIHost: host, nodes, text } = require('../fixtures/synopsisUIHost.cjs');
const { getSynopsisContent } = require('../../shared/synopsisContent');
const root = path.resolve(__dirname, '../..');

test('the editorial screen makes the whole story and every act directly reachable from Overview', () => {
  const h = host();
  assert.equal(nodes(h.render(), 'Text').filter(n => text(n) === 'Play A').length, 1);
  assert.match(text(h.render()), /Two siblings face/);
  assert.ok(h.button('Full story'), 'full story has a direct section control');
  assert.ok(h.button('By act'), 'acts do not require scrolling through the full synopsis');
  assert.doesNotMatch(text(h.render()), /A false letter separates the siblings/);
  h.button('Full story').props.onPress();
  assert.match(text(h.render()), /Contains the ending/);
  assert.match(text(h.render()), /A false letter separates the siblings/);
  assert.equal(h.button('Full story').props.accessibilityState.selected, true);
  h.button('By act').props.onPress();
  assert.doesNotMatch(text(h.render()), /The siblings discover that the letter is false/);
  h.button('ACT I').props.onPress();
  assert.match(text(h.render()), /The siblings discover that the letter is false/);
  assert.equal(h.button('ACT I').props.accessibilityState.expanded, true);
  h.button('Read full play').props.onPress();
  assert.deepEqual(h.calls, [['MIT', { id: 'a' }]]);
  assert.equal(h.button('By act').props.accessibilityState.selected, true);
  assert.equal(h.button('ACT I').props.accessibilityState.expanded, true);
});

test('section scroll positions, expansion and selection stay scoped to the play and survive reader return', () => {
  const h = host();
  assert.ok(h.button('Full story'));
  h.button('Full story').props.onPress();
  nodes(h.render(), 'ScrollView')[0].props.onScroll({ nativeEvent: { contentOffset: { y: 420 } } });
  h.button('By act').props.onPress(); h.button('ACT I').props.onPress();
  nodes(h.render(), 'ScrollView')[0].props.onScroll({ nativeEvent: { contentOffset: { y: 180 } } });
  h.button('Read full play').props.onPress();
  assert.equal(nodes(h.render(), 'ScrollView')[0].props.contentOffset.y, 180);
  h.button('Full story').props.onPress();
  assert.equal(nodes(h.render(), 'ScrollView')[0].props.contentOffset.y, 420);
  h.route.params.id = 'b';
  assert.doesNotMatch(text(h.render()), /Play A|A false letter separates/);
  h.state({ requestedId: 'b', isLoading: false, synopsis: getSynopsisContent(h.entries[1]) });
  assert.equal(h.button('Overview').props.accessibilityState.selected, true);
  assert.equal(nodes(h.render(), 'ScrollView')[0].props.contentOffset.y, 0);
  h.route.params.id = 'a'; h.state({ requestedId: 'a', isLoading: false, synopsis: getSynopsisContent(h.entries[0]) });
  assert.equal(h.button('Full story').props.accessibilityState.selected, true);
  assert.equal(nodes(h.render(), 'ScrollView')[0].props.contentOffset.y, 420);
  h.button('By act').props.onPress();
  assert.equal(h.button('ACT I').props.accessibilityState.expanded, true);
});

test('invalid routes and stale responses never display the previous synopsis under a different title', () => {
  const h = host(); h.render(); h.route.params.id = 'b';
  assert.doesNotMatch(text(h.render()), /Play A|A false letter separates/);
  assert.deepEqual(h.actions.at(-1), { type: 'local-synopsis', id: 'b' });
  h.state({ requestedId: 'b', isLoading: false, synopsis: getSynopsisContent(h.entries[1]) });
  assert.match(text(h.render()), /Play B/);
  h.route.params.id = 'missing';
  assert.match(text(h.render()), /Synopsis unavailable/);
  assert.equal(h.button('Read full play'), undefined);
});

test('all 38 full stories and framing/act summaries remain accessible without truncation', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json'), 'utf8'));
  for (const meta of manifest.plays) {
    const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
    const playFile = path.resolve(root, 'data', meta.play), play = read(playFile);
    const entry = { slug: meta.id, name: meta.displayName, play, synopsis: read(path.resolve(root, 'data', meta.synopsis)),
      sections: play.sections.map(s => read(path.resolve(path.dirname(playFile), s.path))) };
    const h = host({ entries: [entry] });
    assert.ok(h.button('Full story'), meta.id);
    h.button('Full story').props.onPress();
    for (const paragraph of entry.synopsis.fullSynopsis) assert.ok(text(h.render()).includes(paragraph.text), meta.id + ': full paragraph');
    h.button('By act').props.onPress();
    for (const section of getSynopsisContent(entry).summarySections) {
      const control = h.button(section.label);
      assert.ok(control, meta.id + ': actual section ' + section.label);
      control.props.onPress();
      assert.ok(text(h.render()).includes(section.summary), meta.id + ': section prose');
    }
  }
});

test('one natural scroll surface, serif fallback and system scaling remain usable through font readiness', () => {
  const h = host({ fontsLoaded: false });
  assert.ok(h.button('Full story'));
  h.button('Full story').props.onPress();
  const before = text(h.render()); h.fonts(true);
  assert.equal(text(h.render()), before);
  assert.equal(h.button('Full story').props.accessibilityState.selected, true);
  const tree = h.render();
  assert.equal(nodes(tree, 'ScrollView').length, 1);
  assert.deepEqual(nodes(tree, 'SafeAreaView')[0].props.edges, ['left', 'right', 'bottom']);
  const prose = nodes(tree, 'Text').find(n => text(n).startsWith('A false letter'));
  const style = Object.assign({}, ...[prose.props.style].flat(Infinity).filter(Boolean));
  assert.equal(style.fontFamily, 'BardSynopsisSerif');
  assert.ok(style.fontSize >= 18); assert.ok(style.lineHeight >= style.fontSize * 1.5);
  for (const node of nodes(tree, 'Text')) {
    assert.notEqual(node.props.allowFontScaling, false);
    assert.equal(node.props.numberOfLines, undefined);
    const s = Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
    assert.ok(!(s.marginBottom < 0));
  }
});
