# Reader verification

Work was implemented on `feature/interactive-play-reader`, based on `feb04c9352487357346e43ceda479ba8c898e8bb`. The implementation, automated checks and Android checks described below are complete, with explicit limits. Implementation stopped before staging or publication. The user subsequently approved committing this milestone and opening a PR against `v2`; that approval does not authorize merging.

## Fresh precommit verification, 2026-10-19

| Check actually rerun for publication | Result |
| --- | --- |
| `node --test --test-reporter=spec tests/reader/*.test.cjs tests/content/*.test.cjs` | Exit 0; **250/250 passed**, zero failed/skipped/cancelled; 36518.4949 ms. Rerun after the approved license-exception clarification. |
| `node scripts/validateGutenbergFidelity.js --source data/source/pg100-images.html --candidate . --report .expo/reader-verification/precommit-source-validation.json --strict` | Exit 0; **38/38 source validations**, zero errors. Report is temporary; no tracked content output was changed. |
| `node docs/content/bundled-reader-check.cjs` | Exit 0; **38/38 exact matches**, 1,131 sections, 40,758 blocks, 5,067,252 canonical UTF-16 units. |
| Raw baseline hash/length and version comparison | **1,286/1,286 files unchanged**, all 38 content/canonical versions unchanged, no differences in source/generated data, registry or canonical helper against the approved baseline. |
| Scope, secrets and screenshot review | All 76 files match the reviewed inventory; 12 fonts and three licenses match their manifest hashes/sizes; all 17 screenshots reviewed with no sensitive account information. No environment files, caches, temporary artifacts or unrelated files are included. |
| Full `git diff --cached --check` | Exit 2; findings are confined to the three known original-license files below: one line-21 finding each in Literata and Source Serif 4, and 93 line findings in Source Sans 3 because its original CRLF bytes are preserved (including its line-21 trailing U+0020). Total: 95 findings across those three files. This is not an unqualified whitespace pass. |
| Staged whitespace check excluding only the three exact original-license paths | Exit 0; strict whitespace validation passes for every other staged file. Exact command below. |

These are new automated precommit checks. The Android evidence below remains the recorded implementation-session checks, followed by the user's emulator review and appearance approval; Android checks were not repeated merely to publish the commit. Remaining TalkBack traversal, physical-device, release-build, native-selection and performance limits remain unchanged.

The following original licenses match their recorded manifest SHA-256 hashes in both the working files and the staged blobs. Their source text and original bytes were preserved, including line 21's trailing space. Source Sans 3 originally uses CRLF; Git's automatic index normalization was corrected by staging its existing original bytes without filters, without editing the working file or changing Git configuration. The other two licenses retain their original LF bytes.

| Exact license path | Original, working and staged SHA-256 |
| --- | --- |
| `assets/reader-fonts/literata/OFL.txt` | `8742963604cd89dc81437811a850018fc03b2bfad686d7422c8235967c87614e` |
| `assets/reader-fonts/source-sans-3/LICENSE.md` | `89ad2c4f66dd29127527493e729c31e731f111cf10faf5774c3db9275ed0c22c` |
| `assets/reader-fonts/source-serif-4/LICENSE.md` | `75784a295293a8992f5a8d99210566e0064a012e6dab6731305e3787f15896c7` |

```powershell
git diff --cached --check -- . ':(exclude)assets/reader-fonts/literata/OFL.txt' ':(exclude)assets/reader-fonts/source-sans-3/LICENSE.md' ':(exclude)assets/reader-fonts/source-serif-4/LICENSE.md'
```

The final staged inventory remains the same 76 reviewed files. Only this verification document changed after the fresh automated run; reader code, tests, dependencies, font assets and original Shakespeare content match the tested working files. Each staged file was compared with its reviewed working file, accounting only for Git's configured LF/CRLF conversion of ordinary text. Original-license blobs were additionally checked byte for byte as above. No broader whitespace exclusion or validation setting was introduced.

## Automated checks actually run

| Command/check | Actual result |
| --- | --- |
| `node --test --test-reporter=spec tests/reader/*.test.cjs tests/content/*.test.cjs` | Final fresh run: exit 0; 250 passed, zero failed/skipped/cancelled; 33868.5037 ms. [Full output](test-results.txt). Includes 132 existing content tests and 118 reader tests. |
| `node scripts/validateGutenbergFidelity.js --source data/source/pg100-images.html --candidate . --report .expo/reader-verification/reader-source-validation.json --strict` | Exit 0; 38/38 source validations, zero errors. No generator ran or tracked report was overwritten. |
| `node docs/content/bundled-reader-check.cjs` | Exit 0; 38/38 exact old-service reader matches; 1,283 real JSON imports, 1,131 sections, 774 ordinary scenes, 40,758 blocks, 5,067,252 canonical UTF-16 units. This is separate from the new document check. |
| Independent new-document corpus tests | All 38 plays pass through the actual new generator. Independently derived text/order, headings, cue placement, inline tags/ranges/classes, explicit LF and mapped structural separators, IDs and canonical ranges are checked. Corruption fixtures exercise the audit itself. |
| Local font tests | All 12 bundled regular/italic/bold/bold-italic faces contain all 97 printable corpus code points (99 including TAB/LF), including U+00C7 and U+00C9. Font acquisition, timeout, retry, cache and stale completion tests pass. This is separate from native font observations below. |
| `npm.cmd ls expo-asset expo-file-system --depth=0 --json` | Exit 0; existing installed versions 11.1.7 and 18.1.11. Only their direct SDK-compatible declarations and root lockfile declarations were added; no package installation ran. |
| `git diff --check` | Exit 0 at the recorded review. Git warns about future LF/CRLF checkout conversion; it reports no whitespace errors. |
| `$env:EXPO_OFFLINE='1'; $env:CI='1'; node node_modules/expo/bin/cli export --platform web --output-dir .expo/reader-verification/web-export` | Exit 1 before bundling: existing environment lacks `@expo/metro-runtime@~5.0.5`. No installation/configuration change was made. Web iframe/protocol behavior has automated coverage; a web export or browser visual check is not claimed. |

Tests exposed and corrected two native-runtime hazards: serializing a function under Hermes and restoring an old reading point after the user scrolls during delayed font loading. Regression cases failed before the respective fixes and pass now. Older intermediate runs with missing integration boundaries are not substituted for the final full run above.

## Content preservation

[Preservation results](preservation.json) record **1,286/1,286 identical raw file hashes and byte lengths** against the initial checkout, including source, protected support files and generated output. All 38 content versions and canonical versions match both the initial branch baseline and approved content milestone. The collection version remains `8edeb3e4395f126c5844d4c395b151b1e291653a78396d3b55908e90ef627f32`.

The unchanged source SHA-256 is `d7116e381ba4f0164ba059f6d0e135e07af068b4ab486b57fa7deec6a305d5c3` (7,322,300 bytes). The 115 protected files match the original receipt exactly. This checkout initially had CRLF in all 1,171 generated files because `core.autocrlf=true`; only in-memory CRLF-to-LF conversion reproduces their original receipt hashes. No file was normalized or rewritten. Git comparisons against both baseline and milestone report no changes under `data`, `shared/localPlayRegistry.js` or `shared/contentText.js`.

## Android setup and observations

Actual environment: existing MD_420_dpi AVD, `emulator-5554`, 1080×2400 pixels, approximately 412 logical units wide; existing Expo Go 2.33.22. Started the existing emulator without loading its snapshot, preserving app data. Started the installed CLI with `node node_modules/expo/bin/cli start --go --offline --port 8081`, forwarded `adb reverse tcp:8081 tcp:8081`, and opened `exp://127.0.0.1:8081` in `host.exp.exponent`. The user supplied credentials directly in the emulator; no credentials are part of this evidence.

Screenshots are actual Android captures, reviewed for sensitive information before copying here. CDP inspection supplements screenshots with measurements of the Android WebView; DOM measurements alone are not native visual evidence. Development-only WebView debugging is disabled in release mode.

| Performed check | Evidence/result |
| --- | --- |
| Free-library Hamlet, Paper/Literata 20 | [Dialogue, scene heading, stage directions and speaker labels](screenshots/hamlet-paper.png) are readable. Source punctuation and small-cap character formatting remain visible. |
| Native Aa panel | [Paper appearance panel](screenshots/appearance.png), named radio choices, current value and usable controls. Android Back dismisses the panel and leaves the reader open. |
| Actual font changes | Android FontFace entries show loaded faces for each family. At 20px the same canvas text measured 213.5198px in Literata, 196.5798px in Source Serif 4, and 176.8799px in Source Sans 3; selected page families match. This establishes distinct loaded faces, not only changed button labels. |
| Sepia and larger in-app text | [Sepia/Source Sans 3, size 24](screenshots/hamlet-sepia-sans.png); real page CSS reports 24px and 38.4px line height. |
| Night | [Night/Source Serif 4, size 24](screenshots/hamlet-night-serif.png); page, header and status text switch together. |
| In-place updates and reading point | A document-window sentinel survived modal open/close and changes to font, size and theme. An anchored source block remained at 74.3571px then 73.7321px after the accepted rapid Serif→Literata→Serif choices; latest family was Serif. Native scrolling advanced Hamlet from scrollY 2985.52 to 3786.29. |
| Recovered prologue and induction | [Romeo prologue](screenshots/romeo-prologue.png), [Shrew induction I](screenshots/shrew-induction-1.png) and [induction II](screenshots/shrew-induction-2.png) were inspected in the actual free-library reader. Headings, cues, source line breaks and italic Latin text are visible. |
| Accented cue | [Henry V GRANDPRÉ](screenshots/henry-v-accented-cues.png) renders É in the printed cue and stage entrance. DOM code points independently show `U+0047 U+0052 U+0041 U+004E U+0044 U+0050 U+0052 U+00C9 U+002E`. ALENÇON/MARCADÉ are covered by exact corpus and all-face cmap tests; they were not separately spot-checked on Android. |
| Tempest epilogue and final text | [Recovered epilogue](screenshots/tempest-epilogue.png) and [reachable final Exit](screenshots/tempest-final-exit.png). After a native swipe to the end, the 412×762 logical viewport contained the final block at y690.375..738.375 and text-range bounds y691.899..736.476, leaving 25.524px below the actual text. Normal main padding is 24px; body margin is 0. No terminal spacer was added. |
| All offered appearance combinations | [Android WebView measurements](android-reachability.json): 216/216 combinations (3 fonts × 8 app sizes × 3 themes × 3 spacings) pass first/last text bounds and horizontal-overflow checks at system scale 1.5. Minimum final-text clearance 23.9762px. All 12 faces were loaded through native controls first. These are measurements in the real Android WebView; 216 separate screenshots/touch sessions are not claimed. |
| System scale and app limits | [150% Hamlet](screenshots/hamlet-large-system-text.png) and [large-text native panel](screenshots/appearance-large-system-text.png). The app's 30-unit maximum becomes 45px and 16-unit minimum becomes 24px, with endpoint controls disabled. Spacious at size 16/system1.5 yields 43.2px line height. |
| Reset and persistence | Reset restored Paper/Literata20/comfortable in a newly opened play. Night/Serif24 survived the system-scale activity restart; later Sans22 selected in the course reader survived a full Expo Go force-stop/reopen and appeared in the free reader. No app data was cleared. |
| Course entry point | Opened Course → first unlocked Midsummer lesson → READ PLAY; [actual course reader](screenshots/course-reader-paper.png). Font/size changes keep its document sentinel and source block at y76.0655 then75.2679. Back returns to the lesson and course; course remains0/38. No quiz was opened/submitted or lock/progress changed. |
| Smaller native viewport | Temporary density540 on the existing1080px emulator produced320 logical width, together with systemscale1.5. [Tempest final text](screenshots/tempest-small-large-text.png) remains reachable; viewport320×571, block y494.551..547.347, no horizontal overflow, ordinary main padding24px20px. [Aa panel](screenshots/appearance-small-large-text.png) wraps its heading, retains Close, and scrolls through Reset. |

Changing system `font_scale` restarted Expo Go and returned to the welcome screen. The existing public `Main → FreeFolger` navigation was invoked through the development runtime, then actual library Read buttons were used; no auth state was bypassed or modified. Course access used the actual drawer, unlocked lesson and READ PLAY control. The later process restart used `adb shell am force-stop host.exp.exponent` followed by the same existing Expo URL, preserving app data.

The reachability probe is [recorded here](android-reachability-probe.js), with its [local CDP client](android-cdp-evaluate.cjs). Actual invocation: `Get-Content -Raw .expo/reader-verification/reachability.js | node .expo/reader-verification/cdp.cjs .expo/reader-verification/android-reachability.json`, after `adb -s emulator-5554 forward tcp:9223 localabstract:webview_devtools_remote_3064`. The process ID is session-specific; the smaller-viewport process later used8651. The probe requires the actual Tempest page and its three font families already loaded. It changes only the mounted document's appearance, sends monotonically increasing test IDs, restores Paper20/system1.5 and does not persist preferences. Reopen the reader before using native controls after this probe.

TalkBack was temporarily enabled on the emulator. [Modal entry](screenshots/talkback-modal-focus.png) landed on the usable Close control. The original one-frame close handler failed to restore its visible focus ring; a later explicit Aa focus request succeeded, confirming a timing issue. Android's Modal has no supported `onDismiss` callback here, and a controlled real-dialog probe emitted no AppState window-focus events, so waiting solely for that event is unsuitable. The correction waits for the closed React commit and two cancellable frames; [the native recheck returns the visible focus ring to Aa](screenshots/talkback-return-aa.png) after Android Back. Closing intent before commit, reopen/unmount and route-blur cancellation have regression coverage. This is a bounded scheduling fallback, not a native dismissal acknowledgment; additional devices should recheck it. iOS uses its supported `onDismiss` callback and has no native check in this session.

The native focus recheck invoked the existing Aa handler through the development runtime to make modal opening deterministic, then used actual Android Back. Synthetic TalkBack swipe traversal did not produce a reliable focus change; spoken output, complete traversal and heading navigation are not claimed. No notification permission was granted when Accessibility Suite displayed its prompt.

The initial system settings were font_scale1.0, physical density420 with no override, enabled accessibility services absent (`null`), accessibility_enabled0. All were restored and read back: [restoration results](android-settings-restored.json). The app was restarted without clearing its data; [final reader readback](android-final-reader.json) confirms Paper/Literata20/comfortable, systemscale1 and all four selected faces loaded. The emulator is left on Hamlet dialogue, with Metro running for review.

Actual temporary validation commands were `adb shell settings put system font_scale 1.5`, `adb shell wm density 540`, and `adb shell settings put secure enabled_accessibility_services com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService` plus `accessibility_enabled 1`. Restoration used `adb shell settings delete secure enabled_accessibility_services`, `adb shell settings put secure accessibility_enabled 0`, `adb shell wm density reset`, and `adb shell settings put system font_scale 1.0`. These changed emulator settings temporarily; application configuration files, dependencies and app data were not reset.

## Scope and remaining limits

Changed production scope: the two thin reader route wrappers; shared `reader/` document, surfaces, native modal, preferences and fonts; twelve licensed local font faces; and the two allowed dependency declarations. Tests and this evidence describe that scope. Original content/registry/reference helpers, application configuration, auth and course/quiz/progress code are unchanged.

The complete [precommit changed-file inventory](changed-files.txt) includes required new code, tests, font licenses/manifest and intentional screenshots. Local caches, Metro logs, temporary UI dumps, raw screenshots of non-reader screens and generated web output remain ignored and are not part of that inventory. `git diff --cached --name-only` was empty at the implementation checkpoint and again before approved selective staging.

Physical-device checks, release-build checks, iOS/VoiceOver, native-selection/canonical-offset round trips, future annotations, offline packaged-build verification and performance benchmarking are unperformed. Generating exact DOM text does not establish those results. Reading-point restoration is temporary in-memory appearance behavior, not a persisted bookmark or reading-progress feature.
