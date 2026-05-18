const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const SOURCE_FILE = path.join(
  __dirname,
  "..",
  "data",
  "source",
  "pg100-images.html"
);

const OUTPUT_ROOT = path.join(
  __dirname,
  "..",
  "data",
  "plays"
);

const SOURCE_INFO = {
  name: "Project Gutenberg",
  ebookNumber: 100,
  rights: "Public domain in the USA",
  sourceFile: "pg100-images.html"
};

const PLAY_GENRES = {
  "ALL'S WELL THAT ENDS WELL": "Comedy",
  "THE TRAGEDY OF ANTONY AND CLEOPATRA": "Tragedy",
  "AS YOU LIKE IT": "Comedy",
  "THE COMEDY OF ERRORS": "Comedy",
  "THE TRAGEDY OF CORIOLANUS": "Tragedy",
  "CYMBELINE": "Romance",
  "THE TRAGEDY OF HAMLET, PRINCE OF DENMARK": "Tragedy",
  "THE FIRST PART OF KING HENRY THE FOURTH": "History",
  "THE SECOND PART OF KING HENRY THE FOURTH": "History",
  "THE LIFE OF KING HENRY THE FIFTH": "History",
  "THE FIRST PART OF HENRY THE SIXTH": "History",
  "THE SECOND PART OF KING HENRY THE SIXTH": "History",
  "THE THIRD PART OF KING HENRY THE SIXTH": "History",
  "KING HENRY THE EIGHTH": "History",
  "THE LIFE AND DEATH OF KING JOHN": "History",
  "THE TRAGEDY OF JULIUS CAESAR": "Tragedy",
  "THE TRAGEDY OF KING LEAR": "Tragedy",
  "LOVE'S LABOUR'S LOST": "Comedy",
  "THE TRAGEDY OF MACBETH": "Tragedy",
  "MEASURE FOR MEASURE": "Problem Play",
  "THE MERCHANT OF VENICE": "Comedy",
  "THE MERRY WIVES OF WINDSOR": "Comedy",
  "A MIDSUMMER NIGHT'S DREAM": "Comedy",
  "MUCH ADO ABOUT NOTHING": "Comedy",
  "THE TRAGEDY OF OTHELLO, THE MOOR OF VENICE": "Tragedy",
  "PERICLES, PRINCE OF TYRE": "Romance",
  "THE LIFE AND DEATH OF KING RICHARD THE SECOND": "History",
  "KING RICHARD THE THIRD": "History",
  "THE TRAGEDY OF ROMEO AND JULIET": "Tragedy",
  "THE TAMING OF THE SHREW": "Comedy",
  "THE TEMPEST": "Romance",
  "THE LIFE OF TIMON OF ATHENS": "Tragedy",
  "THE TRAGEDY OF TITUS ANDRONICUS": "Tragedy",
  "TROILUS AND CRESSIDA": "Problem Play",
  "TWELFTH NIGHT; OR, WHAT YOU WILL": "Comedy",
  "THE TWO GENTLEMEN OF VERONA": "Comedy",
  "THE TWO NOBLE KINSMEN": "Romance",
  "THE WINTER'S TALE": "Romance"
};

function normalizeText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function normalizeTitleKey(title) {
  return normalizeText(title)
    .toUpperCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const NORMALIZED_PLAY_GENRES = Object.fromEntries(
  Object.entries(PLAY_GENRES).map(([title, genre]) => [
    normalizeTitleKey(title),
    genre
  ])
);

function makePlainText(text) {
  return normalizeText(text)
    .replace(/[^\w\s']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/^the tragedy of /g, "")
    .replace(/^the comedy of /g, "")
    .replace(/^the life of /g, "")
    .replace(/^the life and death of /g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function displayCharacterName(name) {
  return normalizeText(name)
    .replace(/\.$/, "")
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function romanToNumber(roman) {
  const values = { I: 1, V: 5, X: 10 };
  let total = 0;
  let previous = 0;

  for (let i = roman.length - 1; i >= 0; i--) {
    const value = values[roman[i]] || 0;

    if (value < previous) total -= value;
    else total += value;

    previous = value;
  }

  return total;
}

function titleCasePlay(title) {
  return normalizeText(title)
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase())
    .replace(/\bOf\b/g, "of")
    .replace(/\bAnd\b/g, "and")
    .replace(/\bOr\b/g, "or")
    .replace(/\bThe\b/g, "the")
    .replace(/^the\b/i, "The")
    .replace(/\bIi\b/g, "II")
    .replace(/\bIii\b/g, "III")
    .replace(/\bIv\b/g, "IV")
    .replace(/\bVi\b/g, "VI");
}

function parseSceneHeading(text) {
  const clean = normalizeText(text);
  const match = clean.match(/^SCENE\s+([IVX]+)\.\s*(.*)$/i);

  if (!match) {
    return {
      sceneNumber: null,
      title: clean,
      location: clean
    };
  }

  return {
    sceneNumber: romanToNumber(match[1].toUpperCase()),
    title: clean,
    location: normalizeText(match[2])
  };
}

function detectLineType(lines) {
  if (lines.length <= 1) {
    return {
      type: "prose",
      confidence: "medium",
      reason: "single-line speech block"
    };
  }

  const avgLength =
    lines.reduce((sum, line) => sum + line.length, 0) / lines.length;

  if (avgLength <= 75) {
    return {
      type: "verse",
      confidence: "medium",
      reason: "multiple short line breaks"
    };
  }

  return {
    type: "prose",
    confidence: "medium",
    reason: "long average line length"
  };
}

function cleanSpeakerName(text) {
  return normalizeText(text)
    .replace(/\.$/, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .trim();
}

function looksLikeSpeakerName(text) {
  const cleaned = cleanSpeakerName(text);

  if (!cleaned) return false;

  return /^[A-Z0-9][A-Z0-9\s.'’\-&]+$/.test(cleaned);
}

function splitParagraphIntoParts($, element) {
  const html = $(element).html();

  if (!html) return [];

  return html
    .split(/<br\s*\/?>/i)
    .map(part => normalizeText($(`<div>${part}</div>`).text()))
    .filter(Boolean);
}

function parseStageDirection($, element, sceneId, counters) {
  const text = normalizeText($(element).text());

  if (!text) return null;

  counters.stage += 1;

  return {
    id: `${sceneId}-stage-${String(counters.stage).padStart(3, "0")}`,
    type: "stage",
    text
  };
}

function parseDramaParagraph($, element, sceneId, counters) {
  const parts = splitParagraphIntoParts($, element);

  if (parts.length === 0) return null;

  const firstPart = cleanSpeakerName(parts[0]);

  if (!looksLikeSpeakerName(firstPart)) {
    return null;
  }

  const speakerName = firstPart;
  const rawLines = parts.slice(1).map(normalizeText).filter(Boolean);

  if (rawLines.length === 0) return null;

  counters.speech += 1;

  const lineTypeResult = detectLineType(rawLines);

  const lines = rawLines.map((lineText, index) => {
    counters.line += 1;

    return {
      id: `${sceneId}-line-${String(counters.line).padStart(4, "0")}`,
      number: counters.line,
      speechLineNumber: index + 1,
      text: lineText,
      plainText: makePlainText(lineText),
      lineType: lineTypeResult.type,
      lineTypeDetection: "auto",
      lineTypeConfidence: lineTypeResult.confidence,
      lineTypeReason: lineTypeResult.reason
    };
  });

  return {
    id: `${sceneId}-speech-${String(counters.speech).padStart(3, "0")}`,
    type: "speech",
    speaker: {
      id: slugify(speakerName),
      name: speakerName,
      displayName: displayCharacterName(speakerName)
    },
    lines
  };
}

function getPlaySections($) {
  const sections = [];

  $("h2").each((_, h2) => {
    const anchor = $(h2).find("a[id^='chap']").first();

    if (!anchor.length) return;

    const chapterId = anchor.attr("id");
    const title = normalizeText($(h2).text());
    const titleKey = normalizeTitleKey(title);
    const genre = NORMALIZED_PLAY_GENRES[titleKey];

    if (!genre) return;

    sections.push({
      chapterId,
      title,
      id: slugify(title),
      genre,
      h2
    });
  });

  return sections;
}

function collectElementsUntilNextPlay($, startH2) {
  const elements = [];

  let currentBlock = $(startH2).closest("div.chapter").next();

  while (currentBlock.length) {
    const nextPlayHeading = currentBlock.find("h2 a[id^='chap']").first();

    if (nextPlayHeading.length) break;

    elements.push(currentBlock);
    currentBlock = currentBlock.next();
  }

  return elements;
}

function shouldTryAsSpeechParagraph($, element) {
  if (!element || !element.length) return false;
  if (!element.is("p")) return false;

  if (element.is(".scenedesc")) return false;
  if (element.is(".right")) return false;
  if (element.is(".center")) return false;
  if (element.is(".left")) return false;
  if (element.is(".letter")) return false;
  if (element.is(".noindent")) return false;

  const parts = splitParagraphIntoParts($, element);
  if (parts.length < 2) return false;

  return looksLikeSpeakerName(parts[0]);
}

function extractScenesFromPlay($, play) {
  const blocks = collectElementsUntilNextPlay($, play.h2);

  const scenes = [];
  let currentAct = null;
  let orderInPlay = 0;

  for (const block of blocks) {
    const h2 = block.find("h2").first();

    if (h2.length) {
      const h2Text = normalizeText(h2.text());
      const actMatch = h2Text.match(/ACT\s+([IVX]+)/i);

      if (actMatch) {
        currentAct = romanToNumber(actMatch[1].toUpperCase());
      }
    }

    block.find("h3").each((_, h3) => {
      const h3Text = normalizeText($(h3).text());

      if (!/^SCENE\s+[IVX]+\./i.test(h3Text)) return;

      const sceneData = parseSceneHeading(h3Text);

      if (!currentAct || !sceneData.sceneNumber) return;

      orderInPlay += 1;

      const sceneId = `${play.id}-${currentAct}-${sceneData.sceneNumber}`;

      const content = [];
      const counters = {
        stage: 0,
        speech: 0,
        line: 0
      };

      let current = $(h3).next();

      while (current.length) {
        if (current.is("h3") || current.is("h2")) break;

        if (current.is("p.scenedesc") || current.is("p.right")) {
          const stage = parseStageDirection($, current, sceneId, counters);
          if (stage) content.push(stage);
        } else if (current.is("p.drama") || shouldTryAsSpeechParagraph($, current)) {
          const speech = parseDramaParagraph($, current, sceneId, counters);
          if (speech) content.push(speech);
        }

        current = current.next();
      }

      scenes.push({
        schemaVersion: "1.0.0",
        work: {
          id: play.id,
          title: titleCasePlay(play.title),
          author: "William Shakespeare",
          genre: play.genre
        },
        source: SOURCE_INFO,
        scene: {
          id: sceneId,
          act: currentAct,
          scene: sceneData.sceneNumber,
          label: `Act ${currentAct}, Scene ${sceneData.sceneNumber}`,
          title: sceneData.title,
          location: sceneData.location,
          orderInPlay
        },
        content
      });
    });
  }

  return scenes;
}

function getLineCount(sceneJson) {
  return sceneJson.content.reduce((count, item) => {
    if (item.type !== "speech") return count;
    return count + item.lines.length;
  }, 0);
}

function writeSceneFile(playId, sceneJson) {
  const fileName = `act-${sceneJson.scene.act}-scene-${sceneJson.scene.scene}.json`;

  const outputFile = path.join(
    OUTPUT_ROOT,
    playId,
    "scenes",
    fileName
  );

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(sceneJson, null, 2), "utf8");

  return {
    scene: sceneJson.scene.scene,
    id: sceneJson.scene.id,
    label: sceneJson.scene.label,
    title: sceneJson.scene.location,
    path: `./scenes/${fileName}`,
    lineCount: getLineCount(sceneJson)
  };
}

function writePlayFile(play, sceneRefs) {
  const actsMap = new Map();

  for (const sceneRef of sceneRefs) {
    const match = sceneRef.id.match(/-(\d+)-\d+$/);
    const actNumber = match ? Number(match[1]) : null;

    if (!actNumber) continue;

    if (!actsMap.has(actNumber)) {
      actsMap.set(actNumber, []);
    }

    actsMap.get(actNumber).push(sceneRef);
  }

  const acts = Array.from(actsMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([act, scenes]) => ({
      act,
      scenes: scenes.sort((a, b) => a.scene - b.scene)
    }));

  const playJson = {
    schemaVersion: "1.0.0",
    id: play.id,
    title: titleCasePlay(play.title),
    fullTitle: titleCasePlay(play.title),
    author: "William Shakespeare",
    genre: play.genre,
    source: SOURCE_INFO,
    paths: {
      characters: "./characters.json",
      synopsis: "./synopsis.json",
      quiz: "./quiz.json",
      scenes: "./scenes/"
    },
    acts
  };

  const outputFile = path.join(OUTPUT_ROOT, play.id, "play.json");

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(playJson, null, 2), "utf8");
}

function writeEmptySupportFiles(playId) {
  const playFolder = path.join(OUTPUT_ROOT, playId);

  const supportFiles = {
    "characters.json": {
      schemaVersion: "1.0.0",
      characters: []
    },
    "synopsis.json": {
      schemaVersion: "1.0.0",
      playSummary: "",
      acts: [],
      scenes: []
    },
    "quiz.json": {
      schemaVersion: "1.0.0",
      questions: []
    }
  };

  for (const [fileName, content] of Object.entries(supportFiles)) {
    const outputFile = path.join(playFolder, fileName);

    if (!fs.existsSync(outputFile)) {
      fs.writeFileSync(outputFile, JSON.stringify(content, null, 2), "utf8");
    }
  }
}

function main() {
  const html = fs.readFileSync(SOURCE_FILE, "utf8");
  const $ = cheerio.load(html);

  const plays = getPlaySections($);

  console.log(`Found ${plays.length} plays.`);

  const suspicious = [];

  for (const play of plays) {
    const scenes = extractScenesFromPlay($, play);

    if (scenes.length === 0) {
      console.log(`Skipped ${play.title}: no scenes found.`);
      suspicious.push(`${play.id}: no scenes found`);
      continue;
    }

    const sceneRefs = scenes.map(sceneJson => writeSceneFile(play.id, sceneJson));

    writePlayFile(play, sceneRefs);
    writeEmptySupportFiles(play.id);

    const totalLines = sceneRefs.reduce((sum, scene) => sum + scene.lineCount, 0);

    console.log(
      `Created ${play.id}: ${scenes.length} scenes, ${totalLines} lines.`
    );

    if (totalLines < 1000) {
      suspicious.push(`${play.id}: suspiciously low line count (${totalLines})`);
    }
  }

  if (suspicious.length > 0) {
    console.log("\nReview these outputs:");
    suspicious.forEach(item => console.log(`- ${item}`));
  }

  console.log("\nDone.");
}

main();
