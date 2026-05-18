import LOCAL_PLAY_DATA from "./localPlayRegistry";

const htmlEscape = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getQuestions = (quiz) => {
  if (Array.isArray(quiz?.questions)) return quiz.questions;
  if (Array.isArray(quiz)) return quiz;
  return [];
};

const toPlay = (entry) => ({
  id: entry.slug,
  legacyId: entry.legacyId,
  slug: entry.slug,
  name: entry.name || entry.play?.title,
  title: entry.play?.title || entry.name,
  genre: entry.play?.genre || entry.genre,
  difficulty: entry.difficulty,
  mainImage: entry.mainImage,
  medalImage: entry.medalImage,
  quiz: getQuestions(entry.quiz),
  acts: entry.play?.acts || [],
});

export const PLAYS = LOCAL_PLAY_DATA.map(toPlay);

export const getLocalPlayEntry = (id) => {
  const selectedId = id ?? PLAYS[0]?.id;
  const selectedIdText = String(selectedId);

  return LOCAL_PLAY_DATA.find(
    (entry) =>
      entry.slug === selectedIdText ||
      String(entry.legacyId) === selectedIdText ||
      entry.code === selectedIdText
  );
};

export const getLocalPlay = (id) => {
  const entry = getLocalPlayEntry(id);

  if (!entry) {
    throw new Error(`Play not found: ${id}`);
  }

  return toPlay(entry);
};

const getAllSpeakers = (entry) => {
  const speakers = new Map();

  entry.scenes.forEach((scene) => {
    scene.content?.forEach((item) => {
      if (item.type !== "speech" || !item.speaker) return;
      speakers.set(item.speaker.id || item.speaker.name, item.speaker.displayName || item.speaker.name);
    });
  });

  return Array.from(speakers.values()).sort((a, b) => a.localeCompare(b));
};

export const getCharactersHtml = (id) => {
  const entry = getLocalPlayEntry(id);

  if (!entry) {
    throw new Error(`Play not found: ${id}`);
  }

  const generatedCharacters = entry.characters?.characters || [];
  const characterNames =
    generatedCharacters.length > 0
      ? generatedCharacters.map((character) => character.displayName || character.name)
      : getAllSpeakers(entry);

  if (characterNames.length === 0) {
    return `<h2>${htmlEscape(entry.name)}</h2><p>No character data is available yet.</p>`;
  }

  return [
    `<h2>${htmlEscape(entry.name)}</h2>`,
    "<ul>",
    ...characterNames.map((name) => `<li>${htmlEscape(name)}</li>`),
    "</ul>",
  ].join("");
};

export const getSynopsisHtml = (id) => {
  const entry = getLocalPlayEntry(id);

  if (!entry) {
    throw new Error(`Play not found: ${id}`);
  }

  const synopsis = entry.synopsis || {};

  if (synopsis.playSummary || synopsis.acts?.length || synopsis.scenes?.length) {
    return [
      `<h2>${htmlEscape(entry.name)}</h2>`,
      synopsis.playSummary ? `<p>${htmlEscape(synopsis.playSummary)}</p>` : "",
      ...(synopsis.acts || []).map(
        (act) => `<h3>Act ${htmlEscape(act.act)}</h3><p>${htmlEscape(act.summary || "")}</p>`
      ),
      ...(synopsis.scenes || []).map(
        (scene) => `<h3>${htmlEscape(scene.label || scene.id)}</h3><p>${htmlEscape(scene.summary || "")}</p>`
      ),
    ].join("");
  }

  return [
    `<h2>${htmlEscape(entry.name)}</h2>`,
    `<p>${htmlEscape(entry.play?.fullTitle || entry.play?.title || entry.name)}</p>`,
    `<p>Local synopsis data has not been written yet.</p>`,
  ].join("");
};

const renderScene = (scene) => {
  const lines = [
    `<h2>${htmlEscape(scene.scene?.label || "")}</h2>`,
    scene.scene?.title ? `<h3>${htmlEscape(scene.scene.title)}</h3>` : "",
  ];

  scene.content?.forEach((item) => {
    if (item.type === "stage") {
      lines.push(`<p><i>${htmlEscape(item.text)}</i></p>`);
      return;
    }

    if (item.type === "speech") {
      lines.push(`<p><b>${htmlEscape(item.speaker?.displayName || item.speaker?.name || "")}</b></p>`);
      item.lines?.forEach((line) => {
        lines.push(`<p>${htmlEscape(line.text)}</p>`);
      });
    }
  });

  return lines.join("");
};

export const getFullPlayHtml = (id) => {
  const entry = getLocalPlayEntry(id);

  if (!entry) {
    throw new Error(`Play not found: ${id}`);
  }

  return [
    `<h1>${htmlEscape(entry.name)}</h1>`,
    ...entry.scenes.map(renderScene),
  ].join("");
};
