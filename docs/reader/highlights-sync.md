# Highlight synchronization contract

## Authorization and isolation

Emulator mode uses only project `demo-bard-highlights-sync`, Auth port 9199 and Firestore port 8180 on explicitly allowed loopback/emulator hosts. Missing emulators fail closed. Synthetic Auth and storage are separate from the normal session and real highlights.

## Local durability

A versioned per-highlight envelope stores the unchanged local record (or deletion marker), stable cloud identity, server generation/revision, and pending immutable operations in one confirmed AsyncStorage write. No successful local-save report before that write. Local errors and cloud errors are separate. Operation IDs survive restart. Acknowledging an older operation cannot clear a newer edit. Migrate fixture copies resumably, retaining original v1 bytes and local IDs; valid v2 entries take precedence without duplicate display. Invalid/unresolved originals are retained without guessed text relocation. No automatic compaction or eviction.

## Cloud contract

Owner path: `users/{uid}/highlightWorks/{workId}/highlights/{cloudKey}`. A deterministic key uses content/canonical versions and exact UTF-16 range; validate full immutable endpoints on collision. Different occurrences of the same quotation remain distinct. Server records are separate from the strict local schema. Operation receipts and work accounting commit atomically with each accepted mutation. Retried transaction callbacks are pure: no local writes, UI publication or new IDs inside them.

Creation, recoloring and deletion use independent server revisions. Exact duplicates converge; different colors conflict explicitly. Deletion wins over stale updates within its generation; explicit re-creation requires observing the tombstone and deliberate generation advancement. Concurrent overlaps from independent devices are retained and flagged, with no arbitrary paint winner. Keep tombstones/receipts until a separately approved compaction design. Owner generations guard A-to-B-to-A, listeners, reads, writes and acknowledgements. Fixed old-owner writes cannot enter a new owner's state.

## Limits and status

Retain the existing 200 active records/work, 128 KiB record and 512 KiB work limits. Shared accounting must be transactionally consistent and rule-tested. Exact serialized UTF-8 bytes and canonical text validity are client-validated, not claimed independently verified by rules. Bound local operation backlog and listener scope; capacity blocks preserve existing data and explain recovery. Status distinguishes local confirmation, pending/offline, exact server acknowledgement, conflict and permanent failure. Offline/cloud errors do not disable local saving. No promise of synchronization while the app is terminated.

## Rules boundary

An isolated rules fixture is not a replacement for unknown deployed rules. Require owner-only paths, exact schemas/types, immutable selection references, correct revisions/generations, receipt linkage, work accounting, server timestamps and no hard deletion. Test using rule-enforced clients, not privileged bypass. Before production: inspect deployed rules including overlapping grants, validate existing profile/course behavior, approve rules/index changes and separately approve activation.
