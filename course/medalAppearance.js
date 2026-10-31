const neutral = Object.freeze({ fill: '#3b3f43', edge: '#61666b', fold: '#51565b' });
const fabrics = new Map([
  ['Comedy', Object.freeze({ fill: '#275341', edge: '#4d7760', fold: '#3f6b53' })],
  ['Tragedy', Object.freeze({ fill: '#642d3c', edge: '#8c5360', fold: '#854455' })],
  ['History', Object.freeze({ fill: '#3e536a', edge: '#65798c', fold: '#536b82' })],
  ['Romance', Object.freeze({ fill: '#644864', edge: '#896a89', fold: '#7b5c7b' })],
]);

function getMedalAppearance(genre) {
  const genreLabel = typeof genre === 'string' && genre.trim() ? genre.trim() : 'Unclassified';
  return Object.freeze({ genreLabel, strap: fabrics.get(genre) || neutral });
}

module.exports = { getMedalAppearance };
