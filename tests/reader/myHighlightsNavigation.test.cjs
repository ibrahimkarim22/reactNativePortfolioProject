const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flat(Infinity).flatMap(child => nodes(child, type))];
function navigator() {
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useEffect() {}, useState: initial => [initial, () => {}] };
  const native = { StyleSheet: { create: styles => styles }, Platform: { OS: 'android' }, Pressable: 'Pressable', Text: 'Text', View: 'View' };
  const calls = [];
  const load = name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === '@react-navigation/stack') return { createStackNavigator: () => ({ Navigator: 'Stack', Screen: 'StackScreen' }) };
    if (name === '@react-navigation/drawer') return { createDrawerNavigator: () => ({ Navigator: 'Drawer', Screen: 'DrawerScreen' }), DrawerContentScrollView: 'DrawerScroll' };
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === 'expo-constants') return {};
    if (name === 'firebase/auth') return { onAuthStateChanged() {} };
    if (name === '../firebaseConfig') return {};
    if (name.includes('fontawesome')) return {};
    return { __esModule: true, default: name, RootScreen: name };
  };
  const file = path.resolve(__dirname, '../../Componenets/Navigation.js');
  const code = babel.transformFileSync(file, { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] }).code;
  const module = { exports: {} };
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { React })(load, module, module.exports);
  const stack = module.exports.default();
  const main = nodes(stack, 'StackScreen').find(node => node.props.name === 'Main').props.component();
  const drawer = nodes(main, 'Drawer')[0];
  const routeNames = nodes(main, 'DrawerScreen').map(node => node.props.name);
  const content = drawer.props.drawerContent({ state: { routes: routeNames.map(name => ({ name })), routeNames, index: 0 }, navigation: { navigate: (...args) => calls.push(args) } });
  const renderFunctions = tree => typeof tree?.type === 'function' ? renderFunctions(tree.type(tree.props)) : !tree || typeof tree !== 'object' ? tree : { ...tree, props: { ...tree.props, children: (tree.props.children || []).flat(Infinity).map(renderFunctions) } };
  return { stack, main, content: renderFunctions(content), calls };
}
test('normal drawer opens My Highlights and detail uses the stack alongside the unchanged free-reading route', () => {
  const h = navigator();
  const overview = nodes(h.main, 'DrawerScreen').find(node => node.props.name === 'MyHighlights');
  assert.equal(overview?.props.component, '../screens/MyHighlightsScreen');
  assert.equal(overview.props.options.title, 'My Highlights', 'the drawer navigation retains the only page title');
  const detail = nodes(h.stack, 'StackScreen').find(node => node.props.name === 'PlayHighlights');
  assert.equal(detail?.props.component, '../screens/PlayHighlightsScreen');
  assert.equal(nodes(h.stack, 'StackScreen').find(node => node.props.name === 'ReadFolger').props.component, '../screens/Read');
  const item = nodes(h.content, 'Pressable').find(button => nodes(button, 'Text').some(text => text.props.children.includes('My Highlights')));
  assert.ok(item, 'custom drawer includes the registered entry');
  item.props.onPress(); assert.deepEqual(h.calls, [['MyHighlights']]);
  assert.ok(!nodes(h.content, 'Text').some(text => /sync.*test|harness/i.test(text.props.children.join(''))));
});
