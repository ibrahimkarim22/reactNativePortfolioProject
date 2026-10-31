function getMedalCollection(plays, confirmedLevel) {
  const verified = Number.isSafeInteger(confirmedLevel) && confirmedLevel >= 0;
  const catalogue = Array.isArray(plays) ? [...plays].sort((a, b) => a.difficulty - b.difficulty) : [];
  const items = Object.freeze(catalogue.map(play => Object.freeze({ play,
    earned: verified && Number.isSafeInteger(play.difficulty) && play.difficulty > 0 && play.difficulty <= confirmedLevel,
  })));
  const earnedCount = items.filter(item => item.earned).length;
  return Object.freeze({ items, earnedCount, total: items.length, completion: items.length ? earnedCount / items.length : 0 });
}

module.exports = { getMedalCollection };
