# Complete play JSON implementation ledger

Baseline: feature/complete-play-json at 36b38d0. User forbids commits, pushes, merges, another branch, source/support-file replacement and unrelated app changes.

## Stages

1. Record contract; add failing source-backed parser regression tests and pure content-version/selection tests.
2. Implement lossless source-addressed block/section parsing with a guarded, explicit-output CLI.
3. Implement independent exhaustive source validation, schema/reference and attribution checks, plus mutation tests.
4. Extend static registry/service rendering; test actual reader projection and reference order.
5. Generate twice in temporary locations; validate every play, identity/version determinism and support preservation; promote only validated generated inventory.
6. Run complete focused suite, independent review, and record per-play evidence/commands/remaining limitations.

## Interfaces

- Parser: `parseSource(html, options)` returns `{plays:[{play,sections}], source, exclusions, diagnostics}`. `generateCollection({sourceFile,outDir,supportRoot})` writes candidate play trees only; no default production generation.
- Shared canonical API: `buildCanonicalDocument({play,sections})`, `createSelection(document,start,end)`, `resolveSelection(document,selection)`, `createSectionReference(document,sectionId)`, `resolveSectionReference(document,reference)` in `shared/contentText.js` (CommonJS, no Node-only runtime dependencies).
- Version API: `computeContentVersion(play,sections)` and stable serialization in `scripts/contentVersion.js` (Node-only crypto).
- Validator: `validateCollection({sourceFile,candidateRoot})` returns strict structured per-play findings and throws/CLI exits nonzero for discrepancies. It independently reads raw source; no parser extraction helpers.
- Section: `{schemaVersion:'2.0.0',canonicalTextVersion:'1',contentVersion,work,source,section:{id,kind,heading,act,scene,parentSectionId,orderInPlay,sourceRef},content:[{id,type,tag,classes,text,separatorAfter,spans,lines,sourceRef,speakerLabel,attribution}]}`.
- Play refs: `{id,kind,path,act,scene,parentSectionId,orderInPlay,heading}`; section files have the same order; old ordinary scene IDs and paths survive.

## Progress

- Contract recorded with clarification: generated-payload digest defines contentVersion, including text/structure/reference changes for unchanged source.
- No source or support files changed. Stage tests/generation evidence will be appended as work proceeds.
- Parser regression red: `node --test tests/content/parser.test.cjs` => 0/17, missing pure parsing API; old unguarded script was not imported or executed.
- Identity/selection red => 0/26 missing APIs; green `node --test tests/content/selection.test.cjs tests/content/version.test.cjs` => 26/26.
- Parser green after source-backed extraction => 17/17. Additional inherited-prologue regression failed 2 sections vs 1; fixed ownership of paragraph anchors, then parser suite => 18/18.
- First disposable candidate: `C:/Users/ibrah/AppData/Local/Temp/bard-content-first-19tkX1`; 38 plays, 1,132 sections, 40,758 blocks. It is not promoted. Independent validator confirmed source text/occurrence coverage but found metadata/oracle integration issues; corrected candidate must be regenerated and revalidated.
- Decision: retain play-local navigation tables as source content instead of excluding them. This strengthens occurrence accounting; the reader will show the original local contents rather than hiding their text.
- Decision: unlabelled source passages remain explicit `source-unlabelled` records; previous speakers are not guessed. Exact raw flow/cue order remains available to readers. Semantic uncertainty is separate from missing text.
- Independent semantic review found accented, unpunctuated and numbered printed cues omitted from attribution; source-backed tests failed before corrections. Five mixed-case collective cues are now pinned source evidence, not a generalized prose-to-speaker heuristic.
- Fresh review additionally found BALTHASAR's unpunctuated annotated cue and ARIEL'S SONG caption misclassification. A real-source regression failed before the fix; parser suite now 22/22. The validator is independently strengthened so old candidates fail these semantic checks even though their text coverage already passed.
- Registry/service focused suite => 11/11, including every canonical block and nested inline span for all 38 plays. Actual-source selection/section bookmark round trips => 1/1 across all 38.
- Staging/promotion transaction tests => 14/14, covering identical candidates, strict gate failures, stale/tampered input/candidates, protected source/support preservation, junction/output guards and rollback.
- Fresh independent code review: no remaining Critical/Important findings after the two source-attribution fixes. Real production promotion remains gated on strengthened full-corpus validation and identical regeneration.

## Final evidence

- The final validator review added source-title, manifest/catalog, orphan-declaration and exact asset-import gates. Eight image-import mutations failed before the last fix and passed afterwards. Scoped rereview closed the Important finding; no Critical/Important findings remain in the reviewed scope.
- `node --test --test-reporter=spec tests/content/*.test.cjs` passed 132/132 before promotion (32,987.7937 ms) and again after promotion (33,786.5694 ms), zero failures/skips. Final complete output: [test-results.txt](test-results.txt).
- `node scripts/completePlayCollection.js --stage --report docs/content/validation-report.json` passed. Two candidates in `C:/Users/ibrah/AppData/Local/Temp/bard-content-stage-DrdUp5` have identical 1,285-file inventories, bytes, IDs, versions and validation reports. Generated inventory: 1,171 files; candidates including copied support files: 55,321,190 bytes each.
- `node scripts/completePlayCollection.js --promote C:/Users/ibrah/AppData/Local/Temp/bard-content-stage-DrdUp5` passed after both candidates were revalidated with the strengthened validator. It replaced only the 1,171 generated files, removed zero obsolete files and verified all 115 protected source/support hashes.
- Production strict CLI passed with 38/38 plays, 1,131 sections, 40,758/40,758 source/generated blocks, 97,128 explicit source breaks and zero discrepancies. Located exclusions remain narrow: 6 non-play works, document header/footer and 35 formatting rules.
- `node docs/content/bundled-reader-check.cjs` passed actual registry/JSON/service integration: 38/38 exact combined-reader projections, 1,283 real JSON imports, only 76 native image imports stubbed. This is automated HTML/DOM evidence, not Android runtime verification.
- Raw source and all 114 manually maintained support files are unchanged. HEAD remains `36b38d06e20d5cbd9ec9bcc6e058e8cf945b2074` on `feature/complete-play-json`; nothing staged, committed, pushed or merged; no other branch created.
- Full results, content versions, per-play findings, recovered omissions and source ambiguities: [verification.md](verification.md). Native Android rendering, selection offsets and device performance remain unperformed.
