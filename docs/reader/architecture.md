# Local play reader architecture

This document describes the implemented reader contracts. Automated document and lifecycle checks are separate from device screenshots, measured reachability, and assistive technology checks. See [verification.md](verification.md) for actual evidence and remaining limits.

## Shared reading path

Both [Read.js](../../screens/Read.js) and [MITFullPlayScreen.js](../../screens/MITFullPlayScreen.js) pass their explicit route ID to [ReaderScreen.js](../../reader/ReaderScreen.js). The screen resolves the same local play entry and rejects missing or unknown IDs. It does not use the local service's undefined-ID default to open an unrelated play.

[readerDocument.js](../../reader/readerDocument.js) exposes the CommonJS API `createReaderDocument(entry, { documentId })`, returning `{ html, identity, canonical }`. The identity contains `documentId`, `workId`, `contentVersion`, and `canonicalTextVersion`. The screen memoizes this document by the selected entry and its content/canonical revisions. Opening the appearance modal and changing preferences keep the reading surface and its source document mounted.

Metro selects [ReaderSurface.native.js](../../reader/ReaderSurface.native.js) for the local WebView and [ReaderSurface.web.js](../../reader/ReaderSurface.web.js) for a sandboxed `srcDoc` iframe. Both consume the same generated HTML, identity, preferences, and prepared font faces. The older local-service HTML helpers are a separate compatibility path; they do not generate this reading document.

## Canonical text units and layout boundaries

The generator uses the existing [shared/contentText.js](../../shared/contentText.js) `buildCanonicalDocument` contract. It follows `play.sections` order, includes each referenced section once, and does not prepend a second title or support cast. It does not mutate source blocks, generated JSON, stable IDs, or content versions. All offsets are JavaScript UTF-16 code units.

Every source block becomes one element marked `data-reader-block`. Its mapping attributes are:

| Attribute | Meaning |
| --- | --- |
| `data-text-id`, `data-section-id` | Stable source occurrence and owning section. |
| `data-start` | Canonical start of the block's literal text. |
| `data-text-end` | Canonical end of its literal text, before the structural separator. |
| `data-end` | Canonical end including the separator owned by this block. |
| `data-separator` | Exact canonical separator after this block. The final added separator is omitted. |
| `data-boundary` | Layout classification: `paragraph`, `line`, `tab`, `none`, or `mapped`. |
| `data-source-tag`, `data-source-classes` | Original tag/class evidence, including when the safe DOM representation changes. |

Literal `block.text` remains the exact descendant text of its mapped element. Inline formatting and cue wrappers add no characters. NBSP, source case, punctuation, consecutive LF, and explicit trailing LF remain literal text under `white-space: pre-wrap`; there is no broad trim or whitespace collapse. Original inline ranges retain `data-span-index` across any wrappers split to represent overlapping spans. Exact explicit attribution ranges alone receive `data-reader-cue`, `data-cue-start`, and `data-cue-end`. The reader does not infer a speaker from an uppercase caption or infer verse from line shape.

`separatorAfter` has a different role. Its canonical LF/TAB characters are recorded in `data-separator` and represented through layout rather than appended as descendant text. A paragraph boundary (`\n\n`) has one ordinary 12px visual gap. Major/scene heading margins use 40px before and 16px after in place of the ordinary boundary gap. A structural single LF marks a block line boundary; a structural TAB uses inline layout and horizontal separation. Source table cells can become spans while retaining their original tag mapping. These structural separators never consume explicit LF already present inside `block.text`.

For mapped blocks in document order, the canonical text is recovered by concatenating each block's `textContent` and `data-separator`. The final block still retains all explicit text LF even though its final added separator is absent. Whole-body `textContent`, browser `innerText`, and a browser selection's string are not canonical serialization APIs.

A future DOM selection adapter must translate endpoints through these block mappings, sum text-node offsets in UTF-16, account for structural separator ranges, reject surrogate-splitting endpoints, and preserve full document identity when calling the existing canonical reference APIs. That adapter and cross-platform selection round trips are not implemented or verified here. The current DOM range use only measures a temporary visible point for appearance restoration; it is not annotation, selection, bookmark, or persisted progress functionality.

## Viewport and typography

The navigation stack owns the native header, including Back and Reading appearance controls. Its height accounts for the top inset and native text scale. `SafeAreaView` reserves the bottom safe area; the reading surface fills the remaining bounded viewport. The reading document owns the content scroll. Its normal gutter is 24px, reduced to 20px horizontally below 360px, with a maximum 640px text column. End reachability is addressed by these viewport bounds and the ordinary document gutter. There is no EOF spacer or extra terminal padding block.

[readerConstants.js](../../reader/readerConstants.js) defines the Paper/Literata default at size 20 and comfortable line height 1.6, plus the three theme palettes. The document CSS defines the type hierarchy: at default scale the printed title is 32/40, major headings 24/32, and scene headings 21/29. Source alignment and inline italic/bold evidence remain available. Source paragraphs explicitly typed as headings can become `h4` while preserving `data-source-tag="p"`.

Appearance updates change CSS variables on the existing document. React Native `fontScale` is applied once through the document font-size calculation; native WebView `textZoom` stays at 100. The viewport meta tag sets device width and initial scale without imposing a maximum zoom.

## Local execution and bridge security

The document contains escaped source text and attribute values, allowlisted semantic tags/classes, application-owned styles, and one application-owned runtime. Its CSP defaults to no resources, disallows connections and embedded media/frames/objects, permits only data font sources, and permits the fixed nonce-bearing runtime. Source markup cannot supply scripts, event handlers, resource URLs, or executable links.

[readerRuntime.js](../../reader/readerRuntime.js) stores that program once as a fixed `String.raw` source string. The native host does not serialize a function with `Function.toString`; Hermes bytecode and Metro/Babel transforms must not alter the program sent to the WebView. Configuration/identity are escaped JSON data, and [readerProtocol.js](../../reader/readerProtocol.js) builds only a validated call to `window.BardReader.applyAppearance`.

Native navigation permits only `about:blank` and its hash forms. The WebView disables file access, universal file URL access, mixed content, shared/third-party cookies, DOM storage, and automatic new windows. Its broad origin whitelist routes attempted navigations through the rejecting application policy instead of handing them to the OS. Web uses `sandbox="allow-scripts"` with an opaque iframe origin and no referrer. Parent/frame messages check the actual window source and the full document identity; `*` is the transport target for the opaque frame, not permission to accept arbitrary senders.

Only bounded, allowlisted `ready`, `applied`, and `error` messages pass the native/web parser. Appearance request IDs are positive and monotonic; callbacks for a different document or older request are ignored. Diagnostic viewport/scroll/final-block rectangles are bounded bridge data for verification, not controls or application UI. A readiness timeout and surface errors produce reopen guidance. A later successful appearance application clears the appearance error.

## Preferences, fonts, and asynchronous generations

[readerPreferences.js](../../reader/readerPreferences.js) owns the isolated AsyncStorage key `@bard/reader-preferences:v1`:

```json
{"schemaVersion":1,"fontId":"literata","fontSize":20,"lineSpacing":"comfortable","theme":"paper"}
```

Allowed font IDs are `literata`, `source-serif-4`, and `source-sans-3`; size is 16 through 30 in steps of 2; spacing is `compact`/`comfortable`/`spacious` (1.5/1.6/1.8); theme is `paper`/`sepia`/`night`. Stored input is bounded and normalized. Missing/corrupt values fall back to defaults without an initial write. Controls wait for hydration. Writes serialize and use generations so older completions cannot overwrite the latest visible save status. Failed reads allow session changes without overwriting unread settings; retry merges those explicit changes after a successful read. Reset writes only reader defaults. This store does not read or alter authentication, course, quiz, or Redux persistence keys.

[fontAssets.js](../../reader/fontAssets.js) statically imports twelve bundled TTFs: 400/700 normal/italic for each family. Native loading uses `expo-asset` to resolve the bundled asset and `expo-file-system` to read base64. Web reads only bundled same-origin HTTP(S) asset URLs, rejects redirects, and then sends base64 into the isolated document. There is no runtime CDN font service. [fontLoader.js](../../reader/fontLoader.js) caches each family's loading promise, bounds and validates base64, times out acquisition after five seconds, and evicts failures for retry.

[assets/reader-fonts/manifest.json](../../assets/reader-fonts/manifest.json) records upstream URLs, releases, byte sizes, hashes, and cmap coverage metadata. The bundled releases are Literata 3.103, Source Serif 4 4.005R, and Source Sans 3 3.052R. Each ships its SIL Open Font License 1.1 text alongside the assets: [Literata OFL](../../assets/reader-fonts/literata/OFL.txt), [Source Serif license](../../assets/reader-fonts/source-serif-4/LICENSE.md), and [Source Sans license](../../assets/reader-fonts/source-sans-3/LICENSE.md). Keep these notices with redistributed assets.

The font path directly requires SDK 53-compatible `expo-asset` (`~11.1.7`) and `expo-file-system` (`~18.1.11`), declared in `package.json` and the lockfile. It also uses the existing `react-native-webview` (`13.13.5`) and AsyncStorage (`2.1.2`). These package declarations are not a substitute for verifying the installed native application contains its required modules.

Several independent generations protect asynchronous work:

- Native font selection increments a generation on select/cancel; an older load cannot publish over the newly selected family.
- Each surface increments appearance request IDs. The document checks those IDs again after font loading and layout waits, and the surface ignores stale acknowledgments.
- Inside a document, one cached promise/family per curated font ID shares pending font loads and registers successful faces once. Changing size, spacing, scale, or theme reuses those faces; failed loads can retry.
- A temporary source text ID/local UTF-16 offset plus viewport offset is captured before reflow, with a visible-block fallback. Overlapping appearance requests share the point from before their first unsettled reflow. Restoration waits for fonts and two animation frames.
- Runtime interaction generations invalidate an older point on touch, pointer, wheel, keyboard input, or an observed scroll. A change during font acquisition recaptures before styling; a change during settling prevents the old restoration from pulling the user back. This point is held only in memory.

## Accessibility and verification limits

The native controls provide labels, roles, checked/disabled states, at least 48-unit action targets, a scrollable appearance panel, initial modal focus, return focus on close, and dismissal hooks. The underlying reading subtree is hidden from accessibility while the modal is open. Source headings remain semantic DOM headings, exact source text remains accessible, and theme choice is named rather than communicated by color alone.

[useReaderModalFocus.js](../../reader/useReaderModalFocus.js) marks close intent before changing visibility, then restores focus only after the closed commit. Android RN0.79 has no Modal dismissal callback here; two post-commit frames provide a bounded fallback that was checked with emulator TalkBack. iOS waits for Modal.onDismiss. Web focuses the trigger after its closed commit. Reopen, unmount and leaving the reader cancel pending restoration so an outgoing screen cannot take focus from its destination. This does not promise identical timing on every device or a complete screen-reader navigation result.

Those implementation measures do not establish complete TalkBack/VoiceOver traversal, focus containment across native headers and embedded documents, hardware keyboard behavior, or layout at every large text scale. Browser pinch zoom and native assistive scrolling also require platform checks. In-memory restoration depends on browser caret/range geometry; the block fallback is intentionally coarser. Native screenshots, first/last content visibility, line-box behavior for explicit trailing LF, and device font rendering must be assessed on the actual reader separately from static DOM reconstruction.

The focused tests live under [tests/reader](../../tests/reader). The independent corpus audit derives expected text, identities, spans, cues, and boundaries from local JSON for all 38 plays and tests corrupted generated HTML. Runtime tests execute the exact emitted program, including bytecode-style function serialization failure conditions, Babel compilation, font races, restoration, and user interaction. These tests support the documented contracts; they do not certify a future selection adapter or replace device and assistive technology evidence.
