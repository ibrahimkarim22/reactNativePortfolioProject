const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { computeCollectionVersion } = require("./contentVersion");

const COURSE_META = [
  ["alls-well-that-ends-well", 0, "All's Well That Ends Well", "AWW", 17, "AWWimage.png", "mAWW.png"],
  ["antony-and-cleopatra", 1, "Antony and Cleopatra", "Ant", 27, "ANTimage.png", "mANT.png"],
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

function exactFile(root, relative) {
  let current = root;
  for (const part of relative.split("/")) {
    if (!fs.readdirSync(current).includes(part)) {
      throw new Error(`Missing file or incorrect path case: ${path.join(root, relative)}`);
    }
    current = path.join(current, part);
  }
  if (!fs.statSync(current).isFile()) throw new Error(`Expected a file: ${current}`);
  return current;
}

function assetInventory(assetsRoot) {
  const checkout = path.dirname(assetsRoot);
  if (!fs.existsSync(path.join(checkout, ".git"))) return null;
  // Windows can retain old directory-entry case after a Git case-only rename.
  // Tracked names are the runtime import authority in a checkout.
  const tracked = execFileSync("git", ["-c", `safe.directory=${checkout.replace(/\\/g, "/")}`, "ls-files", "-z", "--", "assets"], { cwd: checkout, encoding: "utf8" });
  return new Set(tracked.split("\0").filter(Boolean).map(file => file.slice("assets/".length)));
}

function assertAsset(assetsRoot, inventory, relative) {
  if (inventory) {
    if (!inventory.has(relative) || !fs.existsSync(path.join(assetsRoot, relative))) {
      throw new Error(`Missing tracked asset or incorrect path case: ${relative}`);
    }
  } else {
    exactFile(assetsRoot, relative);
  }
}

function sectionPath(ref, slug) {
  const relative = ref?.path;
  if (typeof relative !== "string" || !/^\.\/(scenes|sections)\/[a-zA-Z0-9-]+\.json$/.test(relative)) {
    throw new Error(`Unsafe section path for ${slug}: ${relative}`);
  }
  return relative.slice(2);
}

function loadBundle(meta, dataRoot, assetsRoot, inventory) {
  const playDir = path.join(dataRoot, "plays", meta.slug);
  const play = JSON.parse(fs.readFileSync(exactFile(playDir, "play.json"), "utf8"));
  if (play.id !== meta.slug) throw new Error(`Play identity mismatch for ${meta.slug}`);
  for (const file of ["characters.json", "synopsis.json", "quiz.json"]) exactFile(playDir, file);
  assertAsset(assetsRoot, inventory, `images/${meta.mainImage}`);
  assertAsset(assetsRoot, inventory, `medalCollection/${meta.medalImage}`);
  const schemaTwo = String(play.schemaVersion).startsWith("2.");
  const sceneRefs = (play.acts || []).flatMap(act => act.scenes || []);
  const refs = schemaTwo ? play.sections : sceneRefs;
  if (!Array.isArray(refs)) throw new Error(`Missing ordered section references for ${meta.slug}`);
  const seen = new Set();
  refs.forEach((ref, index) => {
    const relative = sectionPath(ref, meta.slug);
    if (seen.has(relative)) throw new Error(`Duplicate section path for ${meta.slug}: ${relative}`);
    seen.add(relative);
    const payload = JSON.parse(fs.readFileSync(exactFile(playDir, relative), "utf8"));
    if (schemaTwo && (payload.section?.id !== ref.id || payload.work?.id !== meta.slug || payload.contentVersion !== play.contentVersion)) {
      throw new Error(`Stale section reference for ${meta.slug}: ${relative}`);
    }
    if (schemaTwo && ref.orderInPlay !== index + 1) throw new Error(`Invalid section order for ${meta.slug}: ${relative}`);
  });
  const sceneIndexes = sceneRefs.map(ref => {
    const relative = sectionPath(ref, meta.slug);
    const index = refs.findIndex(section => section.path === ref.path && section.id === ref.id);
    if (index < 0) throw new Error(`Stale ordinary scene reference for ${meta.slug}: ${relative}`);
    return index;
  });
  return { meta, play, refs, sceneIndexes, schemaTwo };
}

function registryParts(bundle, index) {
  const { meta, refs, sceneIndexes, schemaTwo } = bundle;
  const alias = `PLAY_${index}_SECTIONS`;
  const imports = `const ${alias} = [\n${refs.map(ref => `  require("../data/plays/${meta.slug}/${sectionPath(ref, meta.slug)}")`).join(",\n")}\n];`;
  const entry = `  {
    id: ${JSON.stringify(meta.slug)},
    slug: ${JSON.stringify(meta.slug)},
    legacyId: ${meta.legacyId},
    name: ${JSON.stringify(meta.name)},
    code: ${JSON.stringify(meta.code)},
    difficulty: ${meta.difficulty},
    mainImage: require("../assets/images/${meta.mainImage}"),
    medalImage: require("../assets/medalCollection/${meta.medalImage}"),
    play: require("../data/plays/${meta.slug}/play.json"),
    characters: require("../data/plays/${meta.slug}/characters.json"),
    synopsis: require("../data/plays/${meta.slug}/synopsis.json"),
    quiz: require("../data/plays/${meta.slug}/quiz.json"),
    ${schemaTwo ? `sections: ${alias},\n    ` : ""}scenes: [${sceneIndexes.map(scene => `${alias}[${scene}]`).join(", ")}]
  }`;
  return { imports, entry };
}

function buildManifest(bundles) {
  const plays = bundles.map(({ meta, play, schemaTwo }) => ({
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
    quiz: `./plays/${meta.slug}/quiz.json`,
    ...(schemaTwo ? { schemaVersion: play.schemaVersion, canonicalTextVersion: play.canonicalTextVersion, contentVersion: play.contentVersion, sections: play.sections } : {}),
  }));
  const schemaTwo = bundles.every(bundle => bundle.schemaTwo);
  return schemaTwo ? {
    version: "v2",
    schemaVersion: "2.0.0",
    canonicalTextVersion: "1",
    contentVersion: computeCollectionVersion(plays.map(play => ({ workId: play.id, contentVersion: play.contentVersion }))),
    plays,
  } : { version: "v1", plays };
}

function generateRegistry({ dataRoot, output, assetsRoot = path.resolve(__dirname, "../assets") } = {}) {
  if (!dataRoot || !output) throw new Error("Explicit dataRoot and output paths are required.");
  dataRoot = path.resolve(dataRoot);
  output = path.resolve(output);
  assetsRoot = path.resolve(assetsRoot);
  const inventory = assetInventory(assetsRoot);
  const bundles = COURSE_META.map(meta => loadBundle(meta, dataRoot, assetsRoot, inventory));
  const parts = bundles.map(registryParts);
  const contents = `// This file is generated by scripts/generateLocalPlayRegistry.js.\n${parts.map(part => part.imports).join("\n\n")}\n\nconst LOCAL_PLAY_DATA = [\n${parts.map(part => part.entry).join(",\n")}\n];\n\nexport default LOCAL_PLAY_DATA;\n`;
  const manifest = buildManifest(bundles);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, contents, "utf8");
  fs.writeFileSync(path.join(dataRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { output, manifest };
}

function main(argv = process.argv.slice(2)) {
  const options = {};
  const keys = { "--data-root": "dataRoot", "--output": "output", "--assets-root": "assetsRoot" };
  for (let index = 0; index < argv.length; index += 2) {
    if (!keys[argv[index]] || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`Invalid registry argument: ${argv[index]}`);
    options[keys[argv[index]]] = argv[index + 1];
  }
  return generateRegistry(options);
}

module.exports = { COURSE_META, generateRegistry, main };

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
