# Highlight synchronization operations

## Rollback

Pause transport by setting `enabled: false` **while retaining `storageMode: 'durable-v2'`**. Keep v2 envelopes, pending operations, original records, receipts and deletion markers; do not switch back to legacy originals or restore an older local database, which could resurrect deleted records. Local durable saving can continue without cloud IO. Re-enable only after resolving the failure and approving it; retries reuse immutable operation IDs. No automatic fallback changes the project, backend, account or storage mode when connectivity/rules fail.

If a rules rollback is needed, review the deployed state first. Restoring the previous rules disables highlight cloud access while preserving profile/quiz access; it does not delete cloud data. Do not deploy the isolated demo fixture as a rollback or replace live rules blindly. An installed enabled client may retain operations locally until permission is restored; those failures must remain visible.

## Expected IO and retained history

- One owner work-metadata listener, bounded at 128 retained works plus a sentinel; this library has 38 known plays. The overview does not download all quotations or build all canonical play documents. Unknown or excessive history is reported rather than silently truncated.
- One selected-work highlight listener, at most 1,000 retained range documents plus a sentinel. Local pending work recovery is separate from remote overview discovery. Offline catalogue cache is device-local and cannot prove a new server acknowledgement.
- An ordinary accepted mutation reads cloud record, work accounting and operation receipt inside a transaction, then writes those three documents and reads the immutable receipt for confirmation. SDK retries/contention and rule-dependent reads can add IO. The existing permission-contention recovery permits one bounded extra attempt only after fresh reads prove a stale basis. Listener updates add reads for changed matching documents.
- One cloud range document per distinct selection identity, one metadata document per retained work, and one immutable receipt per accepted operation. Recoloring updates its range document and adds a receipt; deletion retains a tombstone and adds a receipt. Idempotent retries reuse the receipt. Tombstones and receipts are not automatically compacted; cloud retained history grows with distinct ranges and accepted mutations, even when active counts fall.
- Existing active limits remain 200/work, 128 KiB/record and 512 KiB/work; pending journals and retained listener limits are also bounded. Reaching a limit reports a specific error and retains data. Rules verify declared accounting, not canonical Shakespeare text or independently computed serialized byte size. Client canonical/reference validation remains required.

Play texts and fonts remain bundled locally. Highlight records/references and their quotation/context are synchronized by the enabled normal app. There is no monthly price promise or billing-plan change.
