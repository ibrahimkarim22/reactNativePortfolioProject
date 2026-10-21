# Highlight storage and rendering

Approved design and clarifications: continue `feature/reader-interactions` at `6221f58881fe089c9de8a57ead686d770f43bc8a`. Preserve both milestone commits and unrelated work. No staging, commits, pushes, branch operations, content regeneration, dependency/configuration changes, auth persistence changes or course-progress mutations.

## Interaction contract

Keep Contents/current location on the left of its existing row. A reserved, stable-size trailing control normally opens **Highlights (count)** and becomes **Highlight** for a live selection. Selection-state changes must not resize the WebView, clear selection through layout, or change the meaning of an in-progress press.

Press-in may prepare a fresh validated Stage 2 capture. A completed intentional activation is required to open the native quotation/color picker; cancelled presses, superseding interactions, invalidation and late callbacks open/save nothing. Accessibility/keyboard activation has an explicit activation path that requests its own capture without requiring touch press-in.

The picker has Yellow, Sage, Blue, Rose, Save and Cancel, a full scrollable quotation, named accessible choices and visible checked state. A successful capture becomes an immutable draft before focus moves; intentional clearing of live selection does not rewrite that draft. Save revalidates owner/work/document and the complete canonical reference. Cancel/Back discard the draft without writing or scrolling. Native selection remains temporary; saved paint is independent of native handles/Copy.

The per-play native panel exposes source-ordered quotation/location/color, Show passage, Edit color and confirmed Remove. Show passage aligns the actual first painted quotation glyph, using its validated range rather than the scene opening. All controls remain usable with long location labels and large system text. No tiny text hit target is required.

## References, persistence and ownership

Use one AsyncStorage record per highlight: `@bard/reader-highlights:v1/<encoded Firebase UID>/<encoded workId>/<annotationId>`. Records contain annotation schemaVersion 1, collision-checked stable ID, owner `{kind:'account',uid}`, workId, complete unchanged Stage 2 selectionRef, allowlisted colorId, revision, createdAt and updatedAt. Do not persist document IDs, capture tokens, selection revisions, DOM nodes or pixels. No guest mode is introduced; absent/unresolved UID permits reading but disables personal-highlight loading/saving.

Central limits: 200 records per UID/work; 128 KiB serialized UTF-8 per record; 512 KiB per UID/work; existing selection cap 16,384 UTF-16. Capacity rejects with a specific message and never evicts/truncates. One shared UID/work queue serializes hydration/mutations across both readers, including returning while an older write is outstanding. Hydrate before any mutation; missing storage is empty without an initial write. Paint/list changes are confirmed only after persistence. Failures retain last-confirmed state and draft; Retry reconciles storage before replaying the explicit intent. No false save success or automatic clearing of corrupt storage.

Retain corrupt/unknown records, isolate their unavailable display, and permit explicit single-record removal; read/discovery failures block mutations until retry. Retain incompatible content/canonical versions as unresolved without painting, relocating or modifying references. Exact duplicate opens the existing editor; unchanged color is a no-op. Adjacent records remain independent. Partial/nested overlaps are rejected with access to the existing entry; stored conflicts are retained and flagged, with no arbitrary paint winner.

Observe the existing Firebase auth singleton locally. Every action/load/write/render acknowledgement is tied to its original UID/work/document/owner generation. Account changes immediately retire counts, quotations, drafts and pending callbacks; conceal old paint until its clear is acknowledged. Already-started writes retain the old fixed key and cannot update the new scope; queued obsolete actions are cancelled. Sign-out clears visible state without deleting records. Appearance Reset is unrelated.

## Painting and bridge

Use CSS Custom Highlight over validated original text-node ranges. Do not wrap, split, replace or insert source text nodes, inject quotation copies into the document, or modify canonical mappings. Preserve layout-backed separators in references; paint only real text intersections. Reject separator-only selections explicitly. Per-theme opaque palette backgrounds and theme body foreground preserve font style/weight/cues; refine readability on actual Android. No arbitrary stored HTML/CSS/selectors. Detect unsupported engines and report unavailable painting while retaining records.

Keep the source document mounted for ordinary operations. Typed highlight commands carry document identity, opaque positive owner generation, monotonic render/navigation request IDs, bounded IDs/ranges/colors and acknowledgements. Existing 8,192-unit general message limit and 131,072-unit capture-response exception stay unchanged; use bounded chunks and atomic commit for larger paint sets. Reject stale identities/revisions/owner generations, malformed data and partial transactions. Clear only application-owned highlight registry names. Precise Show passage coordinates are transient geometry, never persisted identity; coordinate its explicit intent with pending font/position restoration.
