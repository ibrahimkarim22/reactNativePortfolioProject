const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateSynopsisContent } = require('../shared/synopsisContent');
const SOURCE_SHA256 = 'd7116e381ba4f0164ba059f6d0e135e07af068b4ab486b57fa7deec6a305d5c3';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function validateSynopsisCollection({ root = path.resolve(__dirname, '..') } = {}) {
  const manifest = read(path.join(root, 'data/manifest.json'));
  const errors = [], unique = new Map();
  const source = fs.readFileSync(path.join(root, 'data/source/pg100-images.html'));
  if (crypto.createHash('sha256').update(source).digest('hex') !== SOURCE_SHA256) errors.push('The original Gutenberg source changed.');
  if (manifest.plays.length !== 38 || new Set(manifest.plays.map(entry => entry.id)).size !== 38) errors.push('Exactly 38 original catalogue works are required.');
  const plays = manifest.plays.map(entry => {
    try {
      const playFile = path.resolve(root, 'data', entry.play);
      const play = read(playFile);
      const sections = play.sections.map(section => read(path.resolve(path.dirname(playFile), section.path)));
      const synopsis = read(path.resolve(root, 'data', entry.synopsis));
      const result = validateSynopsisContent(synopsis, { play, sections });
      for (const [kind, text] of [['introduction', synopsis.introduction], ['full synopsis', (synopsis.fullSynopsis || []).map(p => p.text).join('\n')],
        ...(synopsis.acts || []).map(act => [`Act ${act.act}`, act.summary])]) {
        const key = String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
        if (key && unique.has(key) && unique.get(key) !== entry.id) result.errors.push(`${kind} duplicates another work.`);
        if (key) unique.set(key, entry.id);
      }
      return { workId: entry.id, paragraphs: synopsis.fullSynopsis?.length || 0, acts: synopsis.acts?.length || 0,
        framing: synopsis.framing?.length || 0, words: result.words, errors: result.errors };
    } catch (error) {
      return { workId: entry.id, paragraphs: 0, acts: 0, framing: 0, errors: [`Cannot validate local package: ${error.message}`] };
    }
  });
  errors.push(...plays.flatMap(play => play.errors.map(error => `${play.workId}: ${error}`)));
  return { passed: errors.length === 0, plays, errors };
}

if (require.main === module) {
  const result = validateSynopsisCollection();
  for (const play of result.plays) console.log(`${play.errors.length ? 'FAIL' : 'PASS'} ${play.workId}: ${play.paragraphs} full paragraphs, ${play.acts} acts, ${play.framing} framing summaries`);
  for (const error of result.errors) console.error(error);
  console.log(`${result.plays.filter(play => !play.errors.length).length}/38 synopsis packages pass structural and canonical-reference validation; editorial accuracy requires separate source review.`);
  process.exitCode = result.passed ? 0 : 1;
}

module.exports = { validateSynopsisCollection };
