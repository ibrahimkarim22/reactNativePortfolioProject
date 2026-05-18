const fs = require("fs");
const path = require("path");

const DATA_ROOT = path.join(__dirname, "..", "data");
const PLAYS_ROOT = path.join(DATA_ROOT, "plays");
const OUTPUT_FILE = path.join(__dirname, "..", "shared", "localPlayRegistry.js");
const MANIFEST_FILE = path.join(DATA_ROOT, "manifest.json");

const COURSE_META = [
  ["alls-well-that-ends-well", 0, "All's Well That Ends Well", "AWW", 17, "AWWimage.png", "mAWW.png"],
  ["antony-and-cleopatra", 1, "Antony and Cleopatra", "Ant", 27, "ANTimage.png", "mAnt.png"],
  ["as-you-like-it", 2, "As You Like It", "AYL", 5, "AYLimage.jpg", "mAYL.png"],
  ["errors", 3, "The Comedy of Errors", "Err", 6, "Errimage.png", "mErr.png"],
  ["the-winters-tale", 4, "The Winter's Tale", "WT", 18, "WTimage.png", "mWT.png"],
  ["coriolanus", 5, "Coriolanus", "Cor", 29, "Corimage.png", "mCor.png"],
  ["cymbeline", 6, "Cymbeline", "Cym", 19, "Cymimage.png", "mCym.png"],
  ["hamlet-prince-of-denmark", 7, "Hamlet", "Ham", 31, "Hamimage.png", "mHam.png"],
  ["the-first-part-of-king-henry-the-fourth", 8, "Henry IV, Part 1", "1H4", 12, "1H4image.png", "m1H4.png"],
  ["the-second-part-of-king-henry-the-fourth", 9, "Henry IV, Part 2", "2H4", 13, "2H4image.png", "m2H4.png"],
  ["king-henry-the-fifth", 10, "Henry V", "H5", 14, "H5image.png", "mH5.png"],
  ["the-first-part-of-henry-the-sixth", 11, "Henry VI, Part 1", "1H6", 36, "1H6image.png", "m1H6.png"],
  ["the-second-part-of-king-henry-the-sixth", 12, "Henry VI, Part 2", "2H6", 37, "2H6image.png", "m2H6.png"],
  ["the-third-part-of-king-henry-the-sixth", 13, "Henry VI, Part 3", "3H6", 38, "3H6image.png", "m3H6.png"],
  ["king-henry-the-eighth", 14, "Henry VIII", "H8", 39, "H8image.png", "mH8.png"],
  ["julius-caesar", 15, "Julius Caesar", "JC", 20, "JCimage.png", "mJC.png"],
  ["king-john", 16, "King John", "Jn", 21, "Jnimage.png", "mJn.png"],
  ["king-lear", 17, "King Lear", "Lr", 32, "Lrimage.png", "mLr.png"],
  ["loves-labours-lost", 18, "Love's Labor's Lost", "LLL", 9, "LLLimage.png", "mLLL.png"],
  ["macbeth", 19, "The Scottish Play", "Mac", 24, "Macimage.png", "mMac.png"],
  ["measure-for-measure", 20, "Measure for Measure", "MM", 16, "MMimage.png", "mMM.png"],
  ["the-merchant-of-venice", 21, "The Merchant of Venice", "MV", 15, "MVimage.png", "mMV.png"],
  ["the-merry-wives-of-windsor", 22, "The Merry Wives of Windsor", "Wiv", 11, "Wivimage.png", "mWiv.png"],
  ["a-midsummer-nights-dream", 23, "A Midsummer Night's Dream", "MND", 1, "MNDimage.jpg", "mMND.png"],
  ["much-ado-about-nothing", 24, "Much Ado About Nothing", "Ado", 7, "Adoimage.png", "mAdo.png"],
  ["othello-the-moor-of-venice", 25, "Othello", "Oth", 25, "Othimage.png", "mOth.png"],
  ["pericles-prince-of-tyre", 26, "Pericles", "Per", 26, "Perimage.png", "mPer.png"],
  ["king-richard-the-second", 27, "Richard II", "R2", 22, "R2image.png", "mR2.png"],
  ["king-richard-the-third", 28, "Richard III", "R3", 23, "R3image.png", "mR3.png"],
  ["romeo-and-juliet", 29, "Romeo and Juliet", "Rom", 2, "Romimage.jpg", "mRom.png"],
  ["the-taming-of-the-shrew", 30, "The Taming of the Shrew", "Shr", 8, "Shrimage.png", "mShr.png"],
  ["the-tempest", 31, "The Tempest", "Tmp", 4, "Tmpimage.jpg", "mTmp.png"],
  ["timon-of-athens", 32, "Timon of Athens", "Tim", 28, "Timimage.png", "mTim.png"],
  ["titus-andronicus", 33, "Titus Andronicus", "Tit", 30, "Titimage.png", "mTit.png"],
  ["troilus-and-cressida", 34, "Troilus and Cressida", "Tro", 33, "Troimage.png", "mTro.png"],
  ["twelfth-night-or-what-you-will", 35, "Twelfth Night", "TN", 3, "TNimage.jpg", "mTN.png"],
  ["the-two-gentlemen-of-verona", 36, "Two Gentlemen of Verona", "TGV", 10, "TGVimage.png", "mTGV.png"],
  ["the-two-noble-kinsmen", 37, "Two Noble Kinsmen", "TNK", 35, "TNKimage.png", "mTNK.png"]
].map(([slug, legacyId, name, code, difficulty, mainImage, medalImage]) => ({
  slug,
  legacyId,
  name,
  code,
  difficulty,
  mainImage,
  medalImage
}));

function requirePath(...parts) {
  return "../" + parts.join("/");
}

function sortSceneFile(a, b) {
  const scenePattern = /^act-(\d+)-scene-(\d+)\.json$/;
  const aMatch = a.match(scenePattern);
  const bMatch = b.match(scenePattern);

  if (!aMatch || !bMatch) return a.localeCompare(b);

  return Number(aMatch[1]) - Number(bMatch[1]) || Number(aMatch[2]) - Number(bMatch[2]);
}

function buildRegistryEntry(meta) {
  const playDir = path.join(PLAYS_ROOT, meta.slug);

  if (!fs.existsSync(path.join(playDir, "play.json"))) {
    throw new Error(`Missing generated play data for ${meta.slug}`);
  }

  const sceneDir = path.join(playDir, "scenes");
  const sceneFiles = fs.existsSync(sceneDir)
    ? fs.readdirSync(sceneDir).filter(file => file.endsWith(".json")).sort(sortSceneFile)
    : [];

  const sceneRequires = sceneFiles
    .map(file => `      require("${requirePath("data", "plays", meta.slug, "scenes", file)}")`)
    .join(",\n");

  return `  {
    id: ${JSON.stringify(meta.slug)},
    slug: ${JSON.stringify(meta.slug)},
    legacyId: ${meta.legacyId},
    name: ${JSON.stringify(meta.name)},
    code: ${JSON.stringify(meta.code)},
    difficulty: ${meta.difficulty},
    mainImage: require("${requirePath("assets", "images", meta.mainImage)}"),
    medalImage: require("${requirePath("assets", "medalCollection", meta.medalImage)}"),
    play: require("${requirePath("data", "plays", meta.slug, "play.json")}"),
    characters: require("${requirePath("data", "plays", meta.slug, "characters.json")}"),
    synopsis: require("${requirePath("data", "plays", meta.slug, "synopsis.json")}"),
    quiz: require("${requirePath("data", "plays", meta.slug, "quiz.json")}"),
    scenes: [
${sceneRequires}
    ]
  }`;
}

function writeManifest() {
  const plays = COURSE_META.map(meta => {
    const play = JSON.parse(
      fs.readFileSync(path.join(PLAYS_ROOT, meta.slug, "play.json"), "utf8")
    );

    return {
      id: meta.slug,
      legacyId: meta.legacyId,
      title: play.title,
      displayName: meta.name,
      genre: play.genre,
      difficulty: meta.difficulty,
      folder: `./plays/${meta.slug}/`,
      play: `./plays/${meta.slug}/play.json`,
      characters: `./plays/${meta.slug}/characters.json`,
      synopsis: `./plays/${meta.slug}/synopsis.json`,
      quiz: `./plays/${meta.slug}/quiz.json`
    };
  });

  fs.writeFileSync(
    MANIFEST_FILE,
    JSON.stringify({ version: "v1", plays }, null, 2) + "\n",
    "utf8"
  );
}

function main() {
  const entries = COURSE_META.map(buildRegistryEntry).join(",\n");
  const contents = `// This file is generated by scripts/generateLocalPlayRegistry.js.
const LOCAL_PLAY_DATA = [
${entries}
];

export default LOCAL_PLAY_DATA;
`;

  fs.writeFileSync(OUTPUT_FILE, contents, "utf8");
  writeManifest();
}

main();
