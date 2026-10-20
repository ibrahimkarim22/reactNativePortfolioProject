# Reader implementation ledger

Approved design: the in-chat reader proposal and the user's implementation safeguards, 2026-10-19.
Baseline: feature/interactive-play-reader, feb04c9352487357346e43ceda479ba8c898e8bb, clean working tree.

## Binding scope

- Shared local WebView reading document, Paper/Literata default, three licensed font families, three themes, native appearance modal and isolated local preferences.
- Preserve source, all generated data/registry, canonical contract, IDs and versions. Never run a generator.
- No authentication/course/progress changes, annotation features, dependency modernization, prebuild, app-data reset or configuration changes.
- No staging, commits, pushes, merges, branch creation or switching. Work in the expressly authorized existing checkout.
- Independently verify the actual new document path for all 38 plays, including mapped structural separators; existing HTML checks are separate.
- Native screenshots and measured first/last content reachability are distinct from automated document tests.

## Stages and interfaces

1. Shared document, default typography, header and layout. `createReaderDocument(entry, {documentId})` returns `{html, identity, canonical}`. Identity contains documentId/workId/contentVersion/canonicalTextVersion. Ordered blocks retain stable IDs and canonical ranges; boundary separators are mapped layout, never broadly trimmed. Native surface remains mounted and accepts validated appearance requests. Document/runtime and independent corpus tests are separate work units.
2. Appearance controls and fonts. A namespaced preference store hydrates before writes; SDK-compatible local asset loading supplies four static faces per selected family. Native and document request generations reject stale font/restoration completions.
3. Persistence/error handling and content-point restoration. Opening a native modal does not remount the document. Typography restores a versioned visible text point after fonts/layout settle; block anchoring is the fallback, not a bookmark feature.
4. Fresh content/reader checks, preservation checks, independent code review and actual Android evidence through both routes. Record unperformed checks honestly.

| Producer / consumer | Interface / review |
| --- | --- |
| Document / independent corpus tests | The actual generator API above; tests derive expectations independently from local JSON. |
| Document runtime / native surface | Scoped identity plus monotonic request ID; validated ready/applied/error messages; only app-owned local document navigation. |
| Preferences / appearance controls | schemaVersion=1; fontId literata/source-serif-4/source-sans-3; size 16..30 step 2; compact/comfortable/spacious; paper/sepia/night. |
| Fonts / runtime | Local base64 TTF faces, allowlisted family; no CDN or broad file access. |
| Native viewport / document layout | One scroller; native bottom-safe viewport and ordinary 24-unit document gutter, no terminal spacer. |

## Progress

- Setup: baseline verified clean. Ruling: use the user's existing checkout and preserve all work; no worktree/branch/commit automation from general skill defaults applies.
- Preservation preflight: all 115 protected files match the original receipt. All 1,171 generated files in this clean checkout use CRLF because core.autocrlf=true; replacing only CRLF with LF in memory exactly reproduces every receipt hash and size, and Git reports no content/registry/contract changes from the milestone. No files were normalized or rewritten. Current raw bytes are separately pinned in the ignored verification baseline and must remain identical throughout this phase.
- Baseline content suite: node --test --test-reporter=spec tests/content/*.test.cjs; exit 0, 132 passed, 0 failed/skipped/cancelled, 37126.0654 ms. This is a fresh pre-implementation run.
- Shared source-generated document and route wrappers are implemented. Source blocks, inline spans, printed cues and explicit breaks remain exact; canonical inter-block separators have explicit layout metadata. The independent corpus tests read every play directly from the registry fixtures and do not derive expected text through the production canonical helper.
- The native Aa modal, isolated preference hydration/write queue, licensed local fonts and guarded appearance updates are integrated. The document object/source remains stable across settings changes. Hermes receives a fixed application-owned program string, not serialized native function bytecode. Independent review reproduced and fixed a user-scroll-during-font-load restoration race, with five failing-then-passing regression cases.
- Final fresh combined suite: `node --test --test-reporter=spec tests/reader/*.test.cjs tests/content/*.test.cjs`; exit 0, 250/250 passed, 0 failed/skipped/cancelled, 33868.5037 ms. This includes the original 132 content tests and 118 reader tests.
- Fresh strict source validation: 38/38 plays, zero errors. Fresh existing bundled service check: 38/38 exact matches. Current raw preservation pins: 1,286/1,286 identical; all 38 content/canonical versions and collection version unchanged. Reports were written only under ignored `.expo/reader-verification/`, not over the content milestone's evidence.
- Web export was attempted with the installed Expo CLI and offline mode. It exits before bundling because the existing environment lacks `@expo/metro-runtime@~5.0.5`. No installation or configuration change was made; the allowed dependency declarations remain only expo-asset and expo-file-system.
- Android checks and reviewed screenshots cover both reader entry points, recovered headings/prologue/induction/epilogue, accented text, actual font families/themes, system150% with app size limits, reset/persistence, reading-point preservation, Android Back and 320-unit width. The final Exit is visible after native scrolling, with ordinary document padding; 216 actual Android WebView appearance combinations pass supplemental reachability measurements. Emulator scale/density/accessibility settings are restored.
- Actual TalkBack testing exposed an early return-focus request. The shared lifecycle hook now schedules after the closed commit (two cancellable Android frames; supported onDismiss on iOS), and native recheck shows Aa focused after Back. Regression tests also cover route blur. Reliable synthetic TalkBack traversal/spoken output, physical-device/release/selection checks and benchmarks remain unperformed. See [verification.md](verification.md) for the actual commands, screenshots, distinctions and limits.
