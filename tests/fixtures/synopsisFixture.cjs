const { buildCanonicalDocument, createSectionReference } = require('../../shared/contentText');

module.exports = function synopsisFixture(workId = 'fixture-play') {
  const contentVersion = 'fixture-content-v1';
  const metadata = [
    { id: `${workId}-prologue`, kind: 'prologue', act: null, heading: 'PROLOGUE', orderInPlay: 1 },
    { id: `${workId}-act-1`, kind: 'act', act: 1, heading: 'ACT I', orderInPlay: 2 },
    { id: `${workId}-1-1`, kind: 'scene', act: 1, heading: 'SCENE I', orderInPlay: 3 },
    { id: `${workId}-epilogue`, kind: 'epilogue', act: 1, heading: 'EPILOGUE', orderInPlay: 4 },
  ];
  const words = ['A speaker introduces a quarrel.', 'ACT I', 'A false letter separates two siblings. They discover the fraud and reunite.', 'The speaker asks the audience to judge.'];
  const sections = metadata.map((section, i) => ({
    work: { id: workId }, contentVersion, canonicalTextVersion: '1', section,
    content: [{ id: `${section.id}-text`, tag: i === 1 ? 'h3' : 'p', text: words[i], separatorAfter: '\n\n' }],
  }));
  const play = { id: workId, contentVersion, canonicalTextVersion: '1', title: 'Fixture Play',
    acts: [{ act: 1 }], sections: metadata.map(section => ({ ...section, path: `./${section.id}.json` })) };
  const canonical = buildCanonicalDocument({ play, sections });
  const ref = id => createSectionReference(canonical, `${workId}-${id}`);
  const synopsis = { schemaVersion: '2.0.0', workId, contentVersion, canonicalTextVersion: '1', synopsisContentVersion: '1.0.0',
    introduction: 'Two siblings face a quarrel after a letter unsettles their home.',
    fullSynopsis: [{ id: `${workId}-summary-01`, text: 'A false letter separates the siblings. They discover the fraud and reunite.', evidence: [ref('1-1')] }],
    acts: [{ act: 1, sectionId: `${workId}-act-1`, label: 'ACT I', summary: 'The siblings discover that the letter is false and reunite.', evidence: [ref('1-1')] }],
    framing: [
      { sectionIds: [`${workId}-prologue`], label: 'Prologue', summary: 'A speaker introduces the quarrel.', evidence: [ref('prologue')] },
      { sectionIds: [`${workId}-epilogue`], label: 'Epilogue', summary: 'The speaker asks the audience to judge.', evidence: [ref('epilogue')] },
    ], scenes: [] };
  return { slug: workId, name: 'Fixture Play', play, sections, synopsis, canonical };
};
