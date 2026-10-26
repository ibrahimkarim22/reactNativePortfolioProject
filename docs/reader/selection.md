# Reader selection

## Mapping contract

A focused DOM adapter reads the current live Range, never its selected string. Text offsets count literal UTF-16 units through nested inline elements. Element offsets count preceding child nodes. Endpoints must lie in the owned `main` reading root or its mapped blocks. A block-end endpoint stops before its canonical separator; a root child boundary after that block includes the separator represented by layout. Crossing blocks includes exact canonical separators. No endpoint clamps, whitespace normalization, text search or reading-position fallbacks are permitted.

DOM attributes supply contiguous block intervals and source identities; literal DOM text and `data-separator` reconstruct the canonical interval. Browser endpoint ownership follows the canonical start-next/end-previous rule, including separators owned by their preceding block. Captures include exact quotation and 32-unit surrogate-safe context. Native receipt validates the full reference through the unchanged `resolveSelection` contract against the verified canonical document. Surrogate splits, outside-root endpoints, inconsistent mappings, collapsed/invalid ranges and captures over 16,384 units are explicitly rejected.

## Lifecycle and protocol

Provisional `selectionChange` state has no quotation and is separate from immutable validated capture snapshots. A typed capture request reads the live Range synchronously, including when `selectionchange` is queued. Document identity, monotonically ordered requests, capture tokens and selection revisions reject obsolete responses. An action requests a fresh snapshot before moving focus; there is no implicit reuse of a previous quotation.

Provisional wire notifications also carry the last processed selection request ID (zero before the first command). Clearing immediately publishes a native-origin cleared state and advances a request barrier; queued notifications from before that clear cannot recreate obsolete provisional state. Native-origin state is explicitly distinguished from validated wire messages.

Aa/Contents opening, jumps, typography/layout changes, document replacement and cancellation clear the live selection and invalidate native pending captures. Actual delayed font registration/reflow also invalidates selection, including a superseded font load. Clearing selection must neither scroll nor interfere with location tracking.

Only allowlisted capture responses may use the 131,072-unit message envelope. Other events retain the 8,192-unit limit. All identities, keys, offsets, references and sequences are checked. Existing CSP, local assets, navigation policy and file capabilities are unchanged.

An opt-in development-only verifier exposes capture quotation/references/rejections. It is disabled by default and absent from production behavior; no raw offsets or debug action controls appear in the ordinary reader.
