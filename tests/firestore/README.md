# Isolated highlight synchronization tests

These fixtures target **only `demo-bard-highlights-sync`**, Auth **9199** and Firestore **8180**. No Firebase login, `.firebaserc`, live project, deployment, export/import, profile or course data is used. All accounts and annotations are synthetic. The rules fixture is **not** a replacement for unknown deployed rules.

Install the locked project dependencies with `npm ci --legacy-peer-deps --ignore-scripts`. The peer-resolution flag preserves the repository's existing React Native/Firebase peer arrangement rather than adding an unrelated older AsyncStorage copy. The two added development dependencies are `firebase-tools` **14.12.1** and `@firebase/rules-unit-testing` **5.0.0**. Firebase remains **12.1.0** and Expo remains **53.0.27**; all pre-existing lockfile package entries are preserved. Use Node **22+** and Java **17+** for the pinned toolchain and its resolved development transitive dependencies. The first emulator run downloads Firestore emulator **1.19.8** through Firebase CLI; logs/cache are local tooling artifacts.

From the repository root, with the fixed ports free:

```powershell
npm.cmd run test:highlight-sync
```

For Android and repeated acceptance runs, keep the isolated emulators running in one terminal:

```powershell
npm.cmd run highlight-sync:emulators
```

Then run rule-enforced clients in another terminal:

```powershell
npm.cmd run test:highlight-sync:clients
```

Both runners hard-code the demo project and isolated config. Tests and application clients independently fail closed when the emulators are unavailable. Never replace these commands with a default-project Firebase command. Android uses `10.0.2.2` for these same ports; Node uses `127.0.0.1`. The named test Firebase app uses in-memory Auth and synthetic `@bard-sync.test` accounts. Storage fixtures use separate `@bard-test/` namespaces. None uses normal app authentication or existing local highlights.

`rules.test.cjs` loads the isolated rules fixture, then performs every acceptance operation through unauthenticated or authenticated **rule-enforced client contexts**. It does not use privileged document writes or privileged reads to establish an allow/deny result. Unique test owners avoid deleting or replacing prior fixture data. Rules loading is emulator-only setup.

`sync.test.cjs` uses two independent named Firebase apps, real emulator Auth accounts and separate local stores. It covers migration, controlled network-pause persistence/restart, lost acknowledgements, duplicate identities, repeated quotations, recolor conflicts, tombstone generations, overlaps, live listeners and different-account isolation. A barrier forces both real transactions to read the same old state, proving a callback actually reruns without changing operation identities or duplicating accounting. Original references from all 38 bundled plays also pass through the rule-enforced transport. These are simulated device clients running in Node, not Android or physical-device observations.

The isolated environment's `setNetworkEnabled(false)` both disables SDK networking and closes an explicit readiness gate before subsequent synchronization RPCs. Resume keeps the gate closed until SDK enable completes; ordered transitions reject stale enable completions. This is a **controlled test transport pause**, not device radio-offline testing. SDK `disableNetwork()` alone did not reliably prevent transaction RPCs on the tested Android path. The gate does not claim to cancel a server operation already in flight; stable receipts and ownership guards still govern its eventual result.

The emulator can report `permission-denied` when another transaction advances the state before the losing transaction's precondition is handled. The adapter permits at most one additional transaction only after fresh owner-scoped reads prove the work revision advanced and validate the related record/receipt. Unchanged state, denied reads and stale ownership do not trigger that recovery. Genuine permission errors remain blocked for explicit attention; there is no unrestricted permission retry loop.

## Enforcement boundary

Rules enforce owner-only paths, exact schemas, bounded fields, immutable selection references, server timestamps, revision/generation transitions, fresh immutable receipt linkage, exact declared accounting deltas and count/declared-byte bounds. Related highlight, receipt and work accounting states must be committed atomically. Hard deletion is forbidden. List queries are bounded; receipt collection listing is denied.

Rules cannot verify the bundled Shakespeare text or independently recompute the exact serialized UTF-8 payload length. Canonical validity, UTF-16 endpoints, exact quotation/context and exact byte counts remain strict client checks. An authenticated malicious client could lie about its own declared byte counter; do not claim server-enforced exact serialized storage size. A trusted server validator would be needed for that stronger guarantee.

Before production activation, separately inspect deployed rules and overlapping grants, existing profile/course behavior, indexes, cloud read/write costs and retained tombstone/receipt growth. Obtain explicit approval for any deployment and activation. No automatic compaction or eviction is implemented.
