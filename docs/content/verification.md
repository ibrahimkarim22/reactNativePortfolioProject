# Bard content milestone verification

Original milestone verification completed on 2026-10-18 on `feature/complete-play-json`, then at HEAD `36b38d06e20d5cbd9ec9bcc6e058e8cf945b2074`. All 38 intended plays passed independent source, structure and attribution checks. Only the approved pipeline, generated content and reading-contract scope changed. At that verification snapshot, nothing was staged, committed, pushed or merged; no additional branch was created. `main` and `v1-maintenance` were at `3e1d1e7df0a759c513c0913ecdf2315a9a9122ec`. Fresh checks for the subsequently approved local commit are recorded at the end of this report.

## Authority and versions

The immutable authority is [data/source/pg100-images.html](../../data/source/pg100-images.html), Project Gutenberg eBook 100, William Shakespeare. It is 7,322,300 bytes. Raw SHA-256:

`d7116e381ba4f0164ba059f6d0e135e07af068b4ab486b57fa7deec6a305d5c3`

Available source metadata: release 1994-01-01; visible update 2025-08-24; HTML modified metadata 2026-05-01T07:55:46.077975+00:00; Ebookmaker 0.13.9. These identify the checked-in snapshot, not an inferred print edition. The original attribution/license material remains in that unchanged source. Generated provenance retains the author, Gutenberg identity, dates, raw checksum and source-stated US public-domain rights.

Schema is `2.0.0`; canonical-text contract is `1`. Collection catalog contentVersion:

`8edeb3e4395f126c5844d4c395b151b1e291653a78396d3b55908e90ef627f32`

Each play has its own full SHA-256 contentVersion in its linked play.json and [manifest](../../data/manifest.json). Table entries below show only the first 12 characters. Versions hash stable serialization of generated meaning: text, separators, ordering, section structure, IDs, spans, attribution, provenance and reference mappings. A correction with unchanged source changes the version if any covered generated meaning changes. Identical regeneration retains it. Tests cover both behaviors, object-key order, self-reference exclusion and non-mutation. The separate source-order digest is `a2d1b4906e8d6c7f94193f92829a575ca83ac6caa0d891433d71b2917886be89`; it is not the legacy catalog-order version.

The [agreed contract](contract.md) specifies source-addressed revision-scoped IDs, UTF-16 exclusive-end ranges, exact/context text, section bookmarks, version-first rejection and explicit future migration. Existing 774 ordinary scene IDs and paths survive. Schema-1 line counters are not reinterpreted as new annotation IDs. Native offset mapping and annotation UI remain future work.

## Commands and actual results

Commands ran from the repository root using the already installed Node v22.12.0 and dependencies. No packages were installed or upgraded. Parser uses parse5 7.3.0; independent validator uses htmlparser2 10.1.0 and acorn 8.15.0; reader DOM checks use cheerio 1.2.0.

| Actual command | Result |
| --- | --- |
| `node --test --test-reporter=spec tests/content/*.test.cjs` | Before promotion: exit 0, 132/132, 0 failed/skipped, 32,987.7937 ms. After promotion: exit 0, 132/132, 0 failed/skipped, 33,786.5694 ms. |
| `node scripts/completePlayCollection.js --stage --report docs/content/validation-report.json` | Exit 0, passed true; two full external candidates generated and independently validated; inventories and bytes identical. |
| `node scripts/completePlayCollection.js --promote C:\Users\ibrah\AppData\Local\Temp\bard-content-stage-DrdUp5` | Exit 0, passed true; both candidates revalidated with final validator, 1,171 generated files promoted, 0 obsolete files removed. |
| `node scripts/validateGutenbergFidelity.js --source data/source/pg100-images.html --candidate . --report docs/content/production-validation.json --strict` | Exit 0; tracked output passed, 38/38 plays, 0 errors. |
| `node docs/content/bundled-reader-check.cjs` | Exit 0; actual promoted registry/JSON/service, 38/38 exact combined-reader text matches. |
| `git --no-optional-locks -c safe.directory=C:/Users/ibrah/Desktop/Dev/bard diff --check` | Exit 0; Git emitted existing Windows LF/CRLF conversion notices. |
| `git --no-optional-locks -c safe.directory=C:/Users/ibrah/Desktop/Dev/bard -c core.autocrlf=false -c core.whitespace=trailing-space,space-before-tab,cr-at-eol diff --check` | Exit 0, no whitespace findings; CRLF is explicitly recognized. |

Full final test output: [test-results.txt](test-results.txt). Staging inventory, hashes, protected-file baseline and both candidate reports: [validation-report.json](validation-report.json). Final independent tracked-output findings and located exclusions: [production-validation.json](production-validation.json). Small tested stages and failed-before-fixed regressions are recorded in [implementation.md](implementation.md).

A diagnostic attempt with `core.autocrlf=false` alone reported CR line endings as trailing whitespace. The explicit `cr-at-eol` command above checks the mixed existing Windows/LF files correctly; source or generated text was not altered to hide that diagnostic.

## Independent validation findings

The independent traversal inventories all 44 source chapter boundaries; chap02 through chap39 are the intended 38 plays. It uses its own HTML tree, text normalization, cue evidence and structural expectations rather than parser extraction helpers. Every meaningful block occurrence is checked bidirectionally for exact text, order, source range/path, ID, lines, separators and inline spans. Structure/attribution are checked separately from text equality. Static registry AST validation checks the complete catalog, ordered imports, ordinary-scene aliases, approved image paths and absence of orphan/development imports without executing them.

Fault-injection tests reject deletion, addition, alteration, reordering, duplication, incorrect speakers/types/section ownership, forged source/inline/line references, stale versions, unreferenced files, title mismatches and unsafe registry imports. Mutations refresh generated digests where needed so an unchanged version does not mask a weak fidelity gate. Unsupported meaningful markup produces a located error.

Totals: **1,131 sections; 40,758 source blocks = 40,758 generated blocks; 97,128 explicit source breaks; 5,067,252 canonical UTF-16 units; zero reported discrepancies**. Canonical text includes source headings, cast, directions, cues, notes and play-local contents tables. Flow-newline/HTML decoding rules are precisely documented in the contract; Unicode, NBSP, punctuation and explicit breaks are preserved.

The 43 located exclusions are 1 document header/navigation range, 6 non-play works, 1 document footer/license range and 35 formatting-only rules. The full raw source/license remains checked in. Local play navigation text is retained; no broad class/table exclusion was introduced.

In this table, source/generated counts are occurrences, not unique text strings. Unlabelled counts describe retained passages without a printed source cue; they are not omissions. PASS includes text, source structure, attribution/reference and per-play version checks.

| Play | Source chapter | Result (errors) | Sections | Source/generated blocks | Explicit breaks | Unlabelled passages | Version prefix |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| [All's Well That Ends Well](../../data/plays/alls-well-that-ends-well/play.json) | chap02 | PASS (0) | 33 | 1145/1145 | 2165 | 91 | `e9a0c9282544` |
| [Antony and Cleopatra](../../data/plays/antony-and-cleopatra/play.json) | chap03 | PASS (0) | 51 | 1571/1571 | 3389 | 178 | `9fd25963907f` |
| [As You Like It](../../data/plays/as-you-like-it/play.json) | chap04 | PASS (0) | 31 | 1008/1008 | 1820 | 72 | `d6b627f880a3` |
| [The Comedy of Errors](../../data/plays/errors/play.json) | chap05 | PASS (0) | 20 | 723/723 | 1687 | 42 | `6ae091bfea46` |
| [Coriolanus](../../data/plays/coriolanus/play.json) | chap06 | PASS (0) | 38 | 1430/1430 | 3265 | 157 | `c67320e7c5db` |
| [Cymbeline](../../data/plays/cymbeline/play.json) | chap07 | PASS (0) | 38 | 1131/1131 | 3386 | 128 | `bbb38f68c66d` |
| [Hamlet](../../data/plays/hamlet-prince-of-denmark/play.json) | chap08 | PASS (0) | 29 | 1431/1431 | 4405 | 169 | `7c006a576f3c` |
| [Henry IV, Part 1](../../data/plays/the-first-part-of-king-henry-the-fourth/play.json) | chap09 | PASS (0) | 28 | 1004/1004 | 2203 | 110 | `077e475bcd5c` |
| [Henry IV, Part 2](../../data/plays/the-second-part-of-king-henry-the-fourth/play.json) | chap10 | PASS (0) | 30 | 1122/1122 | 2257 | 93 | `a53248fd8f61` |
| [Henry V](../../data/plays/king-henry-the-fifth/play.json) | chap11 | PASS (0) | 34 | 958/958 | 2462 | 78 | `cc1f5fddd5f7` |
| [Henry VI, Part 1](../../data/plays/the-first-part-of-henry-the-sixth/play.json) | chap12 | PASS (0) | 36 | 952/952 | 2700 | 139 | `cd380638952f` |
| [Henry VI, Part 2](../../data/plays/the-second-part-of-king-henry-the-sixth/play.json) | chap13 | PASS (0) | 33 | 1060/1060 | 2842 | 118 | `93aa475dc4fd` |
| [Henry VI, Part 3](../../data/plays/the-third-part-of-king-henry-the-sixth/play.json) | chap14 | PASS (0) | 37 | 1083/1083 | 2935 | 123 | `f453521fb4f7` |
| [Henry VIII](../../data/plays/king-henry-the-eighth/play.json) | chap15 | PASS (0) | 27 | 908/908 | 3212 | 86 | `3928fbfe2d1e` |
| [King John](../../data/plays/king-john/play.json) | chap16 | PASS (0) | 25 | 715/715 | 2654 | 67 | `f2e4842ab1f4` |
| [Julius Caesar](../../data/plays/julius-caesar/play.json) | chap17 | PASS (0) | 27 | 1032/1032 | 2489 | 126 | `1cf51df3eb2e` |
| [King Lear](../../data/plays/king-lear/play.json) | chap18 | PASS (0) | 35 | 1365/1365 | 2984 | 155 | `2cc85a47b528` |
| [Love's Labor's Lost](../../data/plays/loves-labours-lost/play.json) | chap19 | PASS (0) | 18 | 1204/1204 | 2276 | 79 | `c0c134a5827f` |
| [The Scottish Play](../../data/plays/macbeth/play.json) | chap20 | PASS (0) | 37 | 914/914 | 2271 | 118 | `36e4184f69df` |
| [Measure for Measure](../../data/plays/measure-for-measure/play.json) | chap21 | PASS (0) | 26 | 1113/1113 | 2237 | 101 | `e7d046d1e7c4` |
| [The Merchant of Venice](../../data/plays/the-merchant-of-venice/play.json) | chap22 | PASS (0) | 29 | 815/815 | 2287 | 75 | `06738752610b` |
| [The Merry Wives of Windsor](../../data/plays/the-merry-wives-of-windsor/play.json) | chap23 | PASS (0) | 32 | 1305/1305 | 1319 | 133 | `85178433e30d` |
| [A Midsummer Night's Dream](../../data/plays/a-midsummer-nights-dream/play.json) | chap24 | PASS (0) | 18 | 671/671 | 1969 | 79 | `8aa631f1bdba` |
| [Much Ado About Nothing](../../data/plays/much-ado-about-nothing/play.json) | chap25 | PASS (0) | 26 | 1140/1140 | 1546 | 67 | `7e76ef5746d7` |
| [Othello](../../data/plays/othello-the-moor-of-venice/play.json) | chap26 | PASS (0) | 24 | 1438/1438 | 3136 | 145 | `059044cf4232` |
| [Pericles](../../data/plays/pericles-prince-of-tyre/play.json) | chap27 | PASS (0) | 31 | 862/862 | 2214 | 90 | `b56209d98172` |
| [Richard II](../../data/plays/king-richard-the-second/play.json) | chap28 | PASS (0) | 28 | 750/750 | 2803 | 84 | `e4f9d9b12e7d` |
| [Richard III](../../data/plays/king-richard-the-third/play.json) | chap29 | PASS (0) | 34 | 1406/1406 | 3625 | 159 | `be979b8f94e7` |
| [Romeo and Juliet](../../data/plays/romeo-and-juliet/play.json) | chap30 | PASS (0) | 34 | 1122/1122 | 2892 | 133 | `63bc83e9b3b3` |
| [The Taming of the Shrew](../../data/plays/the-taming-of-the-shrew/play.json) | chap31 | PASS (0) | 24 | 1134/1134 | 2361 | 128 | `fc1a2839f796` |
| [The Tempest](../../data/plays/the-tempest/play.json) | chap32 | PASS (0) | 19 | 803/803 | 2065 | 77 | `fcfbdbbb660d` |
| [Timon of Athens](../../data/plays/timon-of-athens/play.json) | chap33 | PASS (0) | 27 | 1017/1017 | 2174 | 96 | `abe3b87a6564` |
| [Titus Andronicus](../../data/plays/titus-andronicus/play.json) | chap34 | PASS (0) | 23 | 777/777 | 2523 | 107 | `5ec3eecffbc2` |
| [Troilus and Cressida](../../data/plays/troilus-and-cressida/play.json) | chap35 | PASS (0) | 34 | 1427/1427 | 2979 | 133 | `98381ddbf397` |
| [Twelfth Night](../../data/plays/twelfth-night-or-what-you-will/play.json) | chap36 | PASS (0) | 27 | 1127/1127 | 1683 | 90 | `d2b3758ae542` |
| [Two Gentlemen of Verona](../../data/plays/the-two-gentlemen-of-verona/play.json) | chap37 | PASS (0) | 29 | 1048/1048 | 2003 | 86 | `f984b7552e56` |
| [Two Noble Kinsmen](../../data/plays/the-two-noble-kinsmen/play.json) | chap38 | PASS (0) | 35 | 1127/1127 | 3138 | 150 | `043726ac5c53` |
| [The Winter's Tale](../../data/plays/the-winters-tale/play.json) | chap39 | PASS (0) | 24 | 920/920 | 2772 | 80 | `3b2018ebb4b2` |

## Recovered omissions

All locations below refer to the immutable raw HTML source. The representative cases are regression tests in [parser.test.cjs](../../tests/content/parser.test.cjs); exhaustive source accounting covers the rest of the collection.

| Case | Raw source line(s) | Generated result |
| --- | --- | --- |
| Taming of the Shrew induction | 204198, 204200, 204461 | Ordered induction heading and two induction scenes; scene documents have 47 and 53 blocks, before Act I. No invented Act/Scene 0. |
| Romeo and Juliet prologue | 197106 | Four blocks in `sections/prologue-4464.json`, before Act I. |
| Tempest epilogue | 215154 | Three blocks in `sections/epilogue-133971.json`, after the final scene. |
| Continuations after directions | Helena 3432; Philo 10520; Falstaff 61737; Margaret 194569 | Complete source paragraphs retained in original scene positions; no guessed preceding-speaker assignment. |
| Cue-only Falstaff | 61733 | Original explicit cue preserved separately from the following unlabelled continuation. |
| Hamlet dumb show | 52286 | Full italic source paragraph and nested formatting retained in Act III, Scene II. |
| Henry VIII song and coronation | 100086, 101574 | Complete song and procession paragraphs retained in Act III, Scene I and Act IV, Scene I. |
| Romeo guest list | 197936 | Complete source paragraph retained in Act I, Scene II. |
| Tempest song; Two Gentlemen song stanzas | 211127; 247162, 247170 | Full lyrics/continuations retained with original positions and formatting. |
| Accented, numbered, unpunctuated and annotated cues | Source-backed tests/evidence | Original printed labels retained, including GRANDPRÉ, ALENÇON, MARCADÉ, DENNIS, BARNARDO, numbered petitioners and annotated BALTHASAR. Five exact reviewed mixed-case cues are pinned development evidence. |

For 11 representative recovered complete paragraph bodies (the continuation/song/dumb-show/procession/guest-list cases above), a comparison against HEAD's old scene projection confirmed that each full body was absent, even using a permissive quote/whitespace comparison for that historical diagnostic. Together they contain 3,633 canonical UTF-16 units. This is a sample of confirmed recovery, not a total missing-character estimate; strict completion validation uses the documented exact canonical rules.

## Remaining source ambiguities and discrepancies

There are **no unexplained text, structural, provenance, registry or attribution-validation discrepancies** in this snapshot. There are **4,142 retained source-unlabelled passages** across the collection. Some are continuations, lyrics or stage business with no printed cue in that paragraph. Their original text/format/order is present; the data does not assert an inferred speaker or a verse/prose classification.

Concrete review points, all in the unchanged source:

- Antony and Cleopatra line 10520, raw UTF-16 range [315309,315498): the continuation after the PHILO cue has no repeated cue. Retained in Act I, Scene I with null speakerLabel, source-unlabelled.
- Hamlet line 52286, range [1386725,1387419): italic dumb-show paragraph has no speech cue. Preserved with its inline structure rather than guessed speech attribution.
- Tempest line 211127, range [5681797,5682271): song text follows the song heading at 211123 but lacks its own printed cue. The caption is not a speaker. The later song at 211156 does have an ARIEL cue and is explicitly attributed.
- Henry VIII entrance line 97048 precedes the prologue's own anchor/cue at 97050. Source order is retained: entrance in `sections/setting-3895.json`, followed by explicitly cued prologue in `sections/prologue-4080.json`. It is not silently moved across the source anchor.

These limitations concern semantic inference, not missing source text. No literary wording was invented, modernized, spell-corrected or supplied from memory. A later editorial interpretation must be explicit and versioned.

## Determinism, preservation and reader compatibility

Both candidates at `C:/Users/ibrah/AppData/Local/Temp/bard-content-stage-DrdUp5/candidate-a` and `candidate-b` contained exactly **1,285 files / 55,321,190 bytes each**, with identical per-file SHA-256 records, generated IDs/content versions and validation reports. Of those files, 1,171 are generated (38 play metadata, 1,131 section/scene documents, manifest and static registry); 114 are byte-copied support files used only for candidate validation.

Promotion rechecked current inputs and both candidates, backed up explicit existing generated paths and replaced only the validated generated inventory. All **115 protected hashes** (raw source plus 114 characters/synopsis/quiz files) remained identical before/after. A separate final protected-hash comparison returned no changed files; Git reports no source/support changes. No whole play directory was deleted. Transaction tests cover rejected candidates, stale inputs/receipts, tampering, bounded paths/junctions and rollback.

The actual promoted-bundle check loads **1,283 real JSON files** through the static registry. Only 76 native image imports are stubbed; ESM bindings are adapted for a Node VM. It executes the real service, concatenates the character preface and full-play HTML as the two existing readers do, and independently decodes rendered DOM text. All 38 projections equal canonical whole-work text, including the recovered sections; all 38 schema-2 character prefixes are empty to prevent duplicate cast insertion. Totals match the independent source report.

The automated corpus test also verifies every inline tag/range/class, including 1,081 blocks with nested formatting and 6,463 NBSP characters. Focused tests cover escaping, consecutive/trailing explicit breaks, legacy schema-1 fallback, preserved metadata/order and asset casing. Selection tests cover word/partial-line, cross-block/speech/section ranges, exact/context/end-point checks, Unicode surrogate boundaries, version mismatch rejection and all-38 section-bookmark round trips.

**Android checks not performed at the original content-milestone verification:** app launch/build, Android HTMLView/native layout and typography, glyph/font behavior, device memory/scroll performance, touch/native selection and its offset mapping, bookmark/annotation UI and persistence. No emulator, Android build or native test had been run at that point. Automated DOM equality does not establish these results. See the subsequent Android follow-up below.

## Changed-file summary

- **Pipeline/shared code (8 files):** modified `scripts/parseGutenberg.js`, `scripts/generateLocalPlayRegistry.js`, `shared/localPlayService.js`; added `scripts/completePlayCollection.js`, `scripts/contentVersion.js`, `scripts/validateGutenbergFidelity.js`, `scripts/sourceCueEvidence.json`, `shared/contentText.js`.
- **Tests (9 files):** `tests/content/{parser,fidelity,generation,registry,reader,readerCorpus,selection,selectionCorpus,version}.test.cjs`.
- **Generated (1,171 files):** `data/manifest.json`, `shared/localPlayRegistry.js`, 38 `play.json`, 774 preserved-path ordinary scene documents and 357 additional section documents (including two induction scenes). Of these, 814 are modified tracked files and 357 are newly generated files. Zero generated files deleted.
- **Documentation/evidence (7 text/script files, plus 7 Android screenshots):** this report, `contract.md`, `implementation.md`, `test-results.txt`, `validation-report.json`, `production-validation.json`, `bundled-reader-check.cjs`, and the later Android screenshots, all in `docs/content/`.

Original source and manually maintained support files are unchanged. No UI/navigation/authentication/course changes, educational placeholder authorship, dependency/configuration upgrades or remote content loading were added.

## Encoding and Android follow-up — 2026-10-18

The three accented examples were compared against raw source paragraphs, generated JSON speaker/text fields, and HTML from the actual bundled service. All three content layers agree. This report alone contained literal U+003F question marks; its three examples were corrected from source-confirmed characters. The PowerShell pipe used during report creation has `OutputEncoding.WebName = us-ascii`, explaining that documentation-write failure. UTF-8 readback now verifies the correct report characters. No generated text or contentVersion changed.

| Raw source line | Source / JSON / service HTML cue, escaped | Report before | Report corrected, escaped |
| --- | --- | --- | --- |
| 74794 | `GRANDPR\u00C9.` | `GRANDPR?` | `GRANDPR\u00C9` |
| 77313 | `ALEN\u00C7ON.` | `ALEN?ON` | `ALEN\u00C7ON` |
| 130755 | `MARCAD\u00C9.` | `MARCAD?` | `MARCAD\u00C9` |

U+00C9 is the accented E; U+00C7 is the C with cedilla. The respective generated locations are Henry V Act IV Scene II, Henry VI Part 1 Act I Scene II, and Love's Labour's Lost Act V Scene II. Raw source SHA-256 still matches the approved pin; all 1,171 generated and 115 protected-file hashes match the staging receipt.

The existing MD_420_dpi emulator (API 36) and installed Expo Go 2.33.22 were used with local Expo 53.0.27. No APK/dependency installation or upgrade, native build/prebuild, app-data clearing, or configuration change was performed. The current `npm start` selects dev-client mode, but expo-dev-client is absent and the native android directory is empty, so the local CLI was explicitly started in Expo Go mode:

```powershell
node node_modules/expo/bin/cli start --go --offline --port 8081
```

After starting the existing AVD, the separate terminal commands are:

```powershell
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 shell am start -W -a android.intent.action.VIEW -d exp://127.0.0.1:8081 host.exp.exponent
```

The installed CLI treats `--offline` and `--localhost` as mutually exclusive. The exact command above uses offline mode and the explicit local launch URI through ADB reverse. Android debugging authorization was performed manually by the user.

Two startup findings were observed directly:

- Metro initially returned HTTP 500 because the physical asset entry was `mAnt.png` while Git and the generated registry both use `mANT.png`. All 76 registry asset paths were checked; this was the only physical-case mismatch. A two-step physical rename restored Git's existing spelling. The asset's 130,387 bytes and SHA-256 `661341b1277320cbf2a0dc4d02e77fd9705b93aaff8b6d3155edc7f5f6febb21` were preserved, and Git reports no asset difference. The Android bundle subsequently returned HTTP 200.
- The emulator then showed a black content area. Read-only runtime inspection found RootScreen committed, persistence bootstrapped, positive native dimensions, card progress 1/gesture 0, full opacity and active native screen. Android WindowManager nevertheless marked the drawn activity surface hidden with alpha 0 and retained splash/reveal layers. A normal guest-OS reboot preserved app data and recovered the visible Bard welcome screen. This supports stale Android window state; quickboot specifically was not established as the cause. No app-code correction was made.

### Actual Android reading results

The user manually logged in with an existing account and opened the Free Reading Library. Subsequent assistant actions stayed in that library and its reader, using search and Read cards, ordinary Android touch swipes, and a hardware End key for The Tempest. The assistant did not submit quizzes, enter the Course route or use course-progress controls. No debugger navigation, content injection or stylesheet modification was used to expose text. Read-only runtime/layout inspection helped locate content and distinguish loading, hidden text and clipping; it is not counted as visual proof.

The following observations come from the running Android emulator's actual screen captures, not HTML/DOM projections. The original 1080 x 2400 PNGs are saved in [android-screenshots/](android-screenshots/).

| Check | Actual native observation | Result / evidence |
| --- | --- | --- |
| Romeo and Juliet recovered prologue | After scrolling past front matter, the entrance, CHORUS cue, complete prologue speech and italic exit are visible, with curly punctuation. | Text rendering observed; [screenshot](android-screenshots/romeo-prologue.png). The prologue heading itself fails the contrast check below. |
| Shrew induction, Scene I | Hostess/Sly entrance, SLY and HOSTESS dialogue, italic inline wording and directions are visible before the main play. | Text rendering observed; [screenshot](android-screenshots/shrew-induction-one.png). |
| Shrew induction, Scene II | Continued scrolling reaches the nightgown/attendants direction, Sly's small-ale speech and the servants' responses. | Both recovered induction scenes observed in sequence; [screenshot](android-screenshots/shrew-induction-two.png). Scene headings are not legible. |
| Tempest recovered epilogue | The final-scene ending is followed by PROSPERO's complete epilogue speech through its final line. | Speech rendering observed; [screenshot](android-screenshots/tempest-epilogue.png). The heading is invisible and final exit is clipped, so the complete section's visual check fails. |
| Hamlet loading and touch scrolling | The play loads; repeated ordinary touch swipes reveal the opening entrance, Barnardo/Francisco dialogue and subsequent Marcellus/Horatio passages. No crash was observed during those interactions. | Basic loading and scrolling observed; [opening](android-screenshots/hamlet-opening.png), [later scroll position](android-screenshots/hamlet-scroll.png). No timed performance benchmark or whole-play traversal was performed. |
| Accented character / printed cue | Henry VI, Part 1, Act I Scene II visibly renders `ALEN\u00C7ON.` with its cedilla, followed by the source speech. | Native U+00C7 glyph observed; [screenshot](android-screenshots/alencon-accent.png). GRANDPR\u00C9 and MARCAD\u00C9 were verified in source/JSON/service/report, but not separately inspected on Android. |
| Speaker labels, directions and punctuation | Sampled cues, standalone directions, italic inline text, curly apostrophes and brackets are visible in the captured reader passages. Body paragraphs render red against black. | Sampled rendering observed. Reading comfort and accessibility at other sizes/devices remain manual checks; this is not a formal contrast/accessibility certification. |

### Remaining native reader failures

**Overall Android reader status: failures found.** The recovered text is reaching the native view, but the current reader does not yet provide consistently readable complete sections.

1. **Headings and front matter lack visible contrast.** Sampled play readers initially appear blank beneath their visible toolbar. Scrolling reaches red body paragraphs, while source titles, act/scene/section headings and much of the contents material remain effectively invisible on black. The live native tree includes these heading strings and has positive measured dimensions; their text styles have no explicit foreground color. `screens/Read.js` supplies red for `p` and white for `a`, but no visible foreground for `h1` through `h6` or the retained table-cell `span` text. The `title` style does not style heading tags. This is a native reader-styling failure; source/generated text was not removed or changed.
2. **The final Tempest exit is outside the visible bottom boundary.** At the fully scrolled bottom, including a further upward touch swipe, the final `[Exit.]` does not become visible. The generated epilogue, service output and native text tree contain it. Native measurement placed that final text at page Y 915.04 dp with height 19.43 dp, beyond the 914.29 dp window height. The speech's last line is visible just above the bottom system area. A reader layout/scroll-range or inset correction remains necessary; its exact implementation was not guessed or applied during this check.

The earlier whole-app blank screen was separately recovered by the normal emulator guest reboot. These reader-specific failures remain after that recovery and after successful native text loading. No UI, navigation, authentication, configuration or dependency fix was made to mask them.

At the conclusion of the Android follow-up, the app and Metro were left running, with the reader open at the visible ALEN\u00C7ON cue for the user's own inspection. **Still unperformed:** physical-device checks, release/native build, performance benchmarking (including memory/frame-time testing), alternative font sizes/orientations/themes/devices, full visual proofreading of every play, native selection/offset mapping, bookmarks/annotations and their persistence. Only the free reader was exercised; the other reader consumer was not visually tested. The prior automated 38-play DOM checks remain a separate category of evidence.

Follow-up repository changes were this report and seven development-only screenshots. The asset correction restored the already tracked filename case without an asset Git diff. All original source/support and generated content remained unchanged; at the conclusion of that Android follow-up, no files had been staged, committed, pushed or merged, and the existing branch was retained.

## Local commit verification - 2026-10-18

The user approved one local content-milestone commit, with the two native reader issues explicitly deferred. Before staging, the branch was confirmed as `feature/complete-play-json` at `36b38d06e20d5cbd9ec9bcc6e058e8cf945b2074`, with an empty index. All 1,202 modified/untracked paths were reviewed: exactly 1,171 receipt-listed generated files, 8 pipeline/helper files, 9 tests and 14 documentation/evidence files. No unrelated work, source/support changes, reader UI, dependency/configuration changes, credentials, environment files, local caches or temporary output were selected. Seven screenshots were individually visually reviewed and contain literary reader passages and generic Android status icons; no credentials, account information or sensitive notification content is visible.

Fresh checks for this commit (full output and per-play results appended to [test-results.txt](test-results.txt)):

| Command | Fresh result |
| --- | --- |
| `node --test --test-reporter=spec tests/content/*.test.cjs` | Exit 0; 132/132 passed, 0 failed/cancelled/skipped/todo; 17415.5417 ms. |
| `node scripts/validateGutenbergFidelity.js --source data/source/pg100-images.html --candidate . --report docs/content/production-validation.json --strict` | Exit 0; 38/38 plays, 0 errors. Report exactly matches the post-generation receipt validation. |
| `node docs/content/bundled-reader-check.cjs` | Exit 0; 38/38 exact canonical reader matches, 1,283 real JSON imports, 1,131 sections, 774 ordinary scenes, 40,758 blocks, 5,067,252 canonical UTF-16 units; only 76 native image imports stubbed. |
| `git --no-optional-locks -c safe.directory=C:/Users/ibrah/Desktop/Dev/bard -c core.autocrlf=false -c core.whitespace=trailing-space,space-before-tab,cr-at-eol diff --check` | Exit 0; no whitespace findings. |

Preservation was checked against `validation-report.json` receipt `protectedFiles` and post-generation `generatedFiles`, rather than old HEAD: all 115 protected files and 1,171 generated files match their SHA-256 and byte-size pins, with zero mismatches. All 38 play content versions and the collection version were also recomputed read-only and match existing play/manifest values. No collection regeneration or content/version change was performed.

The Android evidence above remains the actual emulator record. Headings/front matter still have insufficient visibility, and The Tempest's final `[Exit.]` is not fully reachable. No reader fix is included. Physical-device checks, release builds, native selection/offset mapping and performance benchmarking remain unperformed.
