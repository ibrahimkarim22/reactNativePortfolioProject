const { createHash } = require('node:crypto');

function serialize(value, ancestors, omitVersions) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON digest values must be finite numbers.');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError('Only JSON data can be serialized for a content digest.');
  if (ancestors.has(value)) throw new TypeError('Cyclic data cannot be serialized for a content digest.');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError('Only plain JSON objects can be serialized for a content digest.');
  }
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = '[' + Array.from(value, entry => serialize(entry, ancestors, omitVersions)).join(',') + ']';
  } else {
    const keys = Object.keys(value).filter(key => !omitVersions || key !== 'contentVersion').sort();
    result = '{' + keys.map(key => JSON.stringify(key) + ':' + serialize(value[key], ancestors, omitVersions)).join(',') + '}';
  }
  ancestors.delete(value);
  return result;
}

function stableStringify(value) {
  return serialize(value, new Set(), false);
}

function digest(serialized) {
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

function computeContentVersion(play, sections) {
  if (!play || typeof play !== 'object' || !Array.isArray(sections)) {
    throw new TypeError('A generated play and its ordered section payloads are required.');
  }
  // Hash the generated meaning, including provenance and all contract fields.
  // The digest itself is the only excluded field, wherever it is repeated.
  return digest(serialize({ play, sections }, new Set(), true));
}

function computeCollectionVersion(works) {
  if (!Array.isArray(works)) throw new TypeError('Ordered work/version pairs are required.');
  const pairs = works.map(work => {
    if (!work || typeof work.workId !== 'string' || !work.workId || typeof work.contentVersion !== 'string' || !work.contentVersion) {
      throw new TypeError('Every collection entry needs a workId and contentVersion.');
    }
    return [work.workId, work.contentVersion];
  });
  return digest(stableStringify(pairs));
}

module.exports = { stableStringify, computeContentVersion, computeCollectionVersion };
