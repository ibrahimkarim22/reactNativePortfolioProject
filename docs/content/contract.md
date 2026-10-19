# Bard source-faithful content contract

Status: implemented and independently validated; see [verification.md](verification.md) for commands, per-play results and remaining runtime checks. Scope is the 38 existing plays; no app rebuild, educational-content authorship, authentication, course or dependency upgrade.

## Authority

`data/source/pg100-images.html` is immutable input. Raw SHA-256: `d7116e381ba4f0164ba059f6d0e135e07af068b4ab486b57fa7deec6a305d5c3`; 7,322,300 bytes. Gutenberg eBook 100, released 1994-01-01, visible update 2025-08-24, HTML modified metadata 2026-05-01T07:55:46.077975+00:00. These are separate facts, not an inferred print edition. Preserve the source and its license/attribution. Never supply literary text from memory.

## Schema 2

Preserve play slugs, legacy codes, ordinary scene IDs and `scenes/act-N-scene-N.json` paths. `play.json` retains `acts[].scenes[]` and adds authoritative ordered `sections[]` references. Non-scene sections live in `sections/`. Each section document has `schemaVersion`, `canonicalTextVersion`, `contentVersion`, `work`, `source`, `section` and `content`. `section` contains `id`, `kind`, `heading`, `act`, `scene`, `parentSectionId`, `orderInPlay`, and source provenance. Nullable numbers never invent Act/Scene 0. Generated ordinals are not printed source line numbers.

Each content block has a deterministic source-addressed `id`, original `tag`/`classes`, exact canonical `text`, `separatorAfter`, inline formatting `spans`, line ranges, and `sourceRef`. Original cue text is retained in `text`; `speakerLabel` and attribution describe source evidence, never replace it. Unlabelled passages remain unlabelled; previous-cue context is not asserted authorship. Verse/prose may be unknown; no line-length guesses are authoritative. Source cast groups and descriptions are retained, without inventing biographies or splitting uncertain identities.

Printed cues may be classless, accented, numbered, unpunctuated before an explicit BR, or followed by an inline annotation. Five mixed-case collective cues are reviewed at exact pinned source ranges in development-only `scripts/sourceCueEvidence.json`; labels are derived from those source paragraphs. That evidence is checked against the raw source revision and exact paragraph/label before use. Song captions are not invented speakers. An independent validator checks the exceptional locations against its own raw-source traversal; it does not import the parser's evidence table or cue recognition code.

Source references measure UTF-16 offsets in the original decoded HTML (before text transformations), with source line/column and structural path. Text IDs combine the work/section source anchor, structural element path and local fragment/line address. Paths count source structure, not only accepted speeches. Repeated identical text remains distinct. Ordinary scene aliases survive; schema-1 generated line counters are not silently reinterpreted as schema-2 stable references.

## Canonical text version 1

Decode HTML entities; normalize CRLF/CR to LF. Preserve Unicode, punctuation, capitalization, NBSP and explicit indentation. Do not Unicode-normalize. In ordinary HTML flow, source-formatting newline plus adjoining ASCII indentation becomes a single space; remove ASCII formatting whitespace at block/explicit-break edges. Preserve interior ASCII spaces. Preformatted content retains whitespace. Explicit `<br>` becomes LF, including consecutive/trailing breaks. Each paragraph/heading boundary contributes two LFs; table cells use TAB and rows LF. These separators are explicit `separatorAfter` values. The final document has no added trailing separator; original trailing explicit breaks remain. Inline spans use UTF-16 `[start,end)` positions in their block text. Search normalization, if added later, is a derivative and is never the selection/fidelity text.

`buildCanonicalDocument({play, sections})` concatenates block text and separators in section order and returns `{workId,contentVersion,canonicalTextVersion,text,units,sections}`. Unit entries map stable text IDs and section IDs to UTF-16 ranges. Section entries map IDs to ranges. Structural headings, casts, cues, directions and notes are included, once per actual source occurrence. Play-local contents tables may be retained as explicit source content; never broadly exclude tables or paragraph classes.

## Content revisions and selections

`computeContentVersion(play, sections)` computes SHA-256 over a stable-key serialization of the generated schema/canonicalization contract, play identity/structure/provenance and ordered section payloads, excluding self-referential `contentVersion` fields. All canonical text, ordering, semantic attribution, spans, IDs and reference meaning are covered. It is NOT the source checksum. A parser correction with unchanged source changes the version when its generated meaning changes. Identical regeneration retains the version. Collection version hashes the ordered work/version pairs. No timestamps, random IDs or machine paths enter generated output.

The collection catalog version uses the existing manifest catalog order; the independent source traversal still uses chapter order to establish coverage. Source order and catalog order are not interchangeable. Per-play reading order is always the explicit section sequence.

Selections are separate user data: `{kind:'text-range',workId,contentVersion,canonicalTextVersion,offsetUnit:'utf16',start,end,startRef,endRef,exact,prefix,suffix}`. Positions address the canonical whole-work string, `[start,end)`. References identify mapped endpoint text units. Validate version FIRST, then bounds, surrogate boundaries, endpoint mappings and exact/context text. Cross-line/block/speech/section ranges are allowed. Section references include work/version/section ID. Reject mismatches rather than relocating by quotation. Explicit reviewed migration maps are required across revisions. Future native selection adapters must map their actual rendered text and offset units; HTML offsets are not canonical offsets. No W3C-conformance claim, per-word JSON, annotation UI or user database.

## Independent completion gate

An independent exhaustive source traversal must not import the parser's extraction, heading, cue, normalization or exclusion functions. Account every meaningful source occurrence and break, check parser source-span claims, and compare text/order bidirectionally. Separately check schema, reference inventory, section ownership, cue/formatting attribution and known source fixtures. Text equality alone does not prove attribution. Unknown meaningful markup fails with a location. Source-unlabelled passages are preserved and reported, not assigned guessed speakers.

Inventory all 44 chapter boundaries; the intended plays are chap02–chap39. Non-play works, Gutenberg header/footer, document navigation and formatting-only material require explicit located exclusions. Retained local navigation is not an omitted occurrence. Fault-injection tests must reject text deletion/addition/alteration/reordering/duplication, incorrect attribution/section ownership, forged provenance and stale references.

## Ownership and compatibility

Never overwrite the source or existing `characters.json`, `synopsis.json`, `quiz.json`. Generate source casts within canonical sections. Generate into fresh temporary directories, validate twice for identical inventory/bytes/IDs/versions, then promote only an explicit generated-file inventory. Do not delete an entire play folder. Static imports follow ordered section refs, not directory sorting. Runtime imports only play data and compact provenance; raw source, fixtures and audit reports are development-only.

Keep `PLAYS` and HTML service signatures. Full-play HTML owns every canonical section in source order. For schema 2, the legacy character preface returns an empty string to avoid duplicating/reordering cast text. Test the combined output used by both existing readers. Android visual/selection behavior is a separate, unperformed check unless explicitly tested.
