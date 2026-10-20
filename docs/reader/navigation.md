# Reader navigation

The library and course readers share the same navigation. A wrapping, theme-aware location button sits below the existing Back/title/Aa header and occupies normal layout space. Its label opens the native Contents modal. A custom accessibility action, Read from current section, jumps to and focuses the current section; it is not an extra visible toolbar button.

## Source model

`readerNavigation.js` derives ordered items from `play.sections`, checks section ownership and canonical mappings, and uses the existing versioned section-reference helpers. All 1,131 source sections across 38 plays have destinations at their first mapped text block. Source files, stable IDs, labels printed in the text and content versions are unchanged.

Acts are pressable group titles whose destination includes their own opening material. In particular, Henry V II–V, Pericles I–V and Romeo II contain text before Scene I. Scenes retain their actual parents. Prologues and inductions retain their source positions; Shrew's induction has two scene children. Epilogues remain under their recorded Act V parents. Title, original contents, cast and setting are grouped in a Front matter disclosure, automatically opened when current. Internal song headings and original contents-table cells are not separate navigation items. Henry VIII's prologue starts in a paragraph, so heading tags are not required for destinations.

## Location and jumps

The reading line is `min(24, viewportHeight / 5)` CSS pixels below the actual document viewport top. Current location is the last section opening at or above that line, or the first section before any opening crosses it. A two-pixel hysteresis prevents boundary jitter. During heading gaps the preceding section remains current. At the actual scroll bottom, a visible final section opening makes the final section current, even when it cannot align to the reading line. No spacer or fabricated reading percentage is added.

Geometry work is coalesced with animation frames. Scroll-driven location updates are throttled to 100 ms, with a settled update; intentional jumps update immediately. Fonts, appearance updates, viewport resize and body resize trigger fresh geometry. Scroll-driven updates have no accessibility live announcement.

Jumps align the first mapped source block to the reading line, clamped to actual scroll bounds. They use immediate scrolling and preserve the mounted document. A new jump invalidates an old appearance-restoration point. Its source anchor remains available across asynchronous font/layout settlement until a newer jump or user interaction supersedes it. Native accessibility scrolling is observed before delayed alignment or focus, even if its scroll event has not yet arrived. A newer jump first observes preceding scroll changes before establishing its own intent.

## Native modal and focus

Contents marks the current destination, expands front matter when needed, and scrolls its own list to the current entry after layout. Its heading and Close control remain above the scrollable list. Back and accessibility escape dismiss it. Cancelling sends no navigation command and returns focus to the location button using the existing cancellable modal-focus helper.

Choosing a destination cancels trigger-focus restoration. Destination focus waits for the matching jump acknowledgment and the closed modal. Android uses two post-commit frame opportunities because this React Native version has no Android Modal dismissal acknowledgment; iOS waits for `onDismiss`. Reopening, newer intent, appearance opening, errors, route blur and unmount cancel pending handoff. The runtime validates that the jump anchor still survives before focusing its source block with `preventScroll`.

## Protocol and boundaries

Existing appearance messages keep their independent request IDs and 8,192-unit message ceiling. New allowlisted `location` events carry a known section ID and monotonic `locationSeq`; `jumped` acknowledgments carry the latest `navigationId`. Every event checks document ID, work ID, content version and canonical-text version. Native and web surfaces expose typed section jump/focus commands, validate existing section references, ignore stale sequences and preserve their source document. Web additionally checks the owned iframe window.

Application-owned runtime helpers are composed as fixed source strings rather than serializing functions under Hermes. Existing CSP, local fonts/content, navigation rejection policy and file-access restrictions remain in place. Navigation has no persistence, Firebase writes or course-completion effects.

## Original license checkout preservation

The root `.gitattributes` contains `-text` for exactly the three original font-license paths. Literata and Source Serif 4 retain original LF; Source Sans 3 retains original CRLF. Original text, trailing spaces, manifest hashes and byte assertions are unchanged. The isolated checkout regression uses `core.autocrlf=true`, verifies all three original hashes and includes a negative control demonstrating conversion without these rules. It never stages or changes branches in the real repository. The existing license-only whitespace exception is unchanged.
