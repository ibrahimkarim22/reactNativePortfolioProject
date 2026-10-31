const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '../..');
const fixture = require('./synopsisFixture.cjs');
const { getSynopsisContent } = require('../../shared/synopsisContent');

const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(!type || tree.type === type ? [tree] : []),
  ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type)),
];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree)
  : !tree || typeof tree !== 'object' ? '' : (tree.props?.children || []).flat(Infinity).map(text).join(' ');

function synopsisUIHost(options = {}) {
  const entries = options.entries || [fixture('a'), fixture('b')];
  entries[0].name = options.entries ? entries[0].name : 'Play A';
  if (!options.entries) entries[1].name = 'Play B';
  const plays = options.plays || entries.map(entry => ({ id: entry.slug, name: entry.name,
    title: entry.play.title, genre: 'Comedy', mainImage: 'cover:' + entry.slug, medalImage: 'medal:' + entry.slug }));
  const route = { params: { id: entries[0].slug } };
  let state = { requestedId: entries[0].slug, isLoading: false, synopsis: getSynopsisContent(entries[0]) };
  let fontsLoaded = options.fontsLoaded !== false, currentFrame, effects;
  const calls = [], actions = [], scrolls = [], frames = new Map(), cache = new Map();
  const navigation = { navigate: (...args) => calls.push(args) };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  function invoke(type, props) {
    const identity = type.name + ':' + (props.key || '');
    if (!frames.has(identity)) frames.set(identity, { slots: [], cursor: 0 });
    const previous = currentFrame; currentFrame = frames.get(identity); currentFrame.cursor = 0;
    try { return type(props); } finally { currentFrame = previous; }
  }
  const React = {
    createElement(type, props, ...children) {
      const next = { ...props, children };
      if (typeof type === 'function') return invoke(type, next);
      if (type === 'ScrollView' && next.ref && !next.ref.current) next.ref.current = { scrollTo: value => scrolls.push(value) };
      return { type, props: next };
    },
    useState(initial) {
      const index = currentFrame.cursor++, storage = currentFrame.slots;
      if (!(index in storage)) storage[index] = typeof initial === 'function' ? initial() : initial;
      return [storage[index], value => { storage[index] = typeof value === 'function' ? value(storage[index]) : value; }];
    },
    useRef(value) {
      const index = currentFrame.cursor++, storage = currentFrame.slots;
      if (!(index in storage)) storage[index] = { current: value };
      return storage[index];
    },
    useMemo(fn, deps) {
      const index = currentFrame.cursor++, storage = currentFrame.slots;
      if (!same(storage[index]?.deps, deps)) storage[index] = { deps, value: fn() };
      return storage[index].value;
    },
    useEffect(fn, deps) {
      const index = currentFrame.cursor++, storage = currentFrame.slots;
      if (!same(storage[index], deps)) effects.push(() => { storage[index] = deps; fn(); });
    },
  };
  const native = Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'StatusBar', 'ActivityIndicator', 'TextInput', 'Image'].map(name => [name, name]));
  native.StyleSheet = { create: value => value };
  native.Platform = { OS: 'android', select: value => value.android || value.default };
  native.Keyboard = { dismiss: () => calls.push(['keyboard-dismiss']) };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    if (/\.(?:png|jpg|ttf)$/.test(file)) return file;
    const code = babel.transformFileSync(path.join(root, file), { babelrc: false, configFile: false,
      plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
    const module = { exports: {} };
    vm.runInThisContext('(function(require,module,exports,React){' + code + '\n})', { filename: file })(name => {
      if (name === 'react') return React;
      if (name === 'react-native') return native;
      if (name === 'expo-font') return { useFonts: () => [fontsLoaded, null] };
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
      if (name === 'react-native-gesture-handler') return { ScrollView: 'ScrollView' };
      if (name === '@react-navigation/native') return { useRoute: () => route, useNavigation: () => navigation };
      if (name === 'react-redux') return { useDispatch: () => action => actions.push(action), useSelector: select => select({ folger: state }) };
      if (name.endsWith('/folgerSlice')) return { fetchFolger: id => ({ type: 'local-synopsis', id }) };
      if (name.endsWith('/localPlayService')) return { PLAYS: plays, getLocalPlayEntry: id => entries.find(e => e.slug === id || e.legacyId === id) };
      if (name.endsWith('/synopsisContent')) return require('../../shared/synopsisContent');
      if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name + (path.extname(name) ? '' : '.js'))));
      throw Error('Unexpected dependency ' + name);
    }, module, module.exports, React);
    cache.set(file, module.exports); return module.exports;
  }
  const file = options.screen || 'screens/JustSynopsis.js';
  const h = { calls, actions, scrolls, entries, plays, route,
    render() { effects = []; const tree = invoke(load(file).default, {}); effects.forEach(run => run()); return tree; },
    button(label) { return nodes(h.render(), 'Pressable').find(n => n.props.accessibilityLabel === label || text(n) === label); },
    state(next) { state = next; }, fonts(loaded) { fontsLoaded = loaded; },
  };
  return h;
}

module.exports = { synopsisUIHost, nodes, text };
