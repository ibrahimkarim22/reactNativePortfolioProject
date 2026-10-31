const SYNOPSIS_GENRES = Object.freeze(['All', 'Comedy', 'Tragedy', 'History', 'Romance']);
const searchable = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/['\u2018\u2019]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function filterSynopsisPlays(plays, query = '', genre = 'All') {
  const terms = searchable(query).split(' ').filter(Boolean);
  return plays.filter(play => (genre === 'All' || play.genre === genre)
    && terms.every(term => searchable([play.name, play.title, play.id, ...(play.aliases || [])].join(' ')).includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true })
      || a.id.localeCompare(b.id));
}

module.exports = { SYNOPSIS_GENRES, filterSynopsisPlays };
