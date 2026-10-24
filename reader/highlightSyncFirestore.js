const { assertIsolatedHighlightEnvironment } = require('./highlightSyncEnvironment');
const { validateOperation, validateCloudRecord, validateMetadata, validateReceipt, planServerMutation, syncError } = require('./highlightSyncProtocol');

const MAX_LISTENER_DOCUMENTS = 1000;
const pathPart = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\/\u0000-\u001f]/.test(value) && value !== '.' && value !== '..';

function createFirestoreHighlightSyncTransport({ environment }) {
  const env = assertIsolatedHighlightEnvironment(environment), sdk = env.sdk;
  function current(uid, isCurrent) {
    if (env.auth.currentUser?.uid !== uid || (isCurrent && isCurrent() !== true)) throw syncError('SYNC_CANCELLED');
  }
  async function commit(input, { isCurrent } = {}) {
    const operation = validateOperation(input);
    current(operation.uid, isCurrent);
    await env.assertReady();
    current(operation.uid, isCurrent);
    const parts = ['users', operation.uid, 'highlightWorks', operation.workId];
    const workRef = sdk.doc(env.db, ...parts), cloudRef = sdk.doc(env.db, ...parts, 'highlights', operation.cloudKey);
    const receiptRef = sdk.doc(env.db, ...parts, 'operations', operation.operationId);
    // Create no identities or local effects inside the retryable transaction.
    const serverTimestamp = sdk.serverTimestamp();
    let basis = null;
    const transact = () => sdk.runTransaction(env.db, async transaction => {
      current(operation.uid, isCurrent);
      await env.assertReady();
      current(operation.uid, isCurrent);
      const [cloudSnapshot, metadataSnapshot, receiptSnapshot] = await Promise.all([
        transaction.get(cloudRef), transaction.get(workRef), transaction.get(receiptRef),
      ]);
      current(operation.uid, isCurrent);
      const result = planServerMutation({ operation, cloud: cloudSnapshot.exists() ? cloudSnapshot.data() : null,
        metadata: metadataSnapshot.exists() ? metadataSnapshot.data() : null, receipt: receiptSnapshot.exists() ? receiptSnapshot.data() : null, serverTimestamp });
      // This private read basis is diagnostic only: no local storage, published
      // state or operation identity changes when the SDK reruns the callback.
      basis = { cloudRevision: cloudSnapshot.exists() ? cloudSnapshot.data().serverRevision : 0,
        metadataRevision: metadataSnapshot.exists() ? metadataSnapshot.data().revision : 0, receiptExists: receiptSnapshot.exists() };
      if (result.writes) {
        transaction.set(cloudRef, result.cloud);
        transaction.set(receiptRef, result.receipt);
        transaction.set(workRef, result.metadata);
      }
      return result;
    });
    let planned;
    try { planned = await transact(); }
    catch (error) {
      if (error.code !== 'permission-denied' || !basis || basis.receiptExists) throw error;
      // get/getAfter rules may evaluate a competing commit before the backend
      // reports a transaction precondition conflict. Recover only once, and only
      // when fresh authorized server reads prove that the failed read basis is
      // stale. Unchanged state and actual permission denial never busy-retry.
      current(operation.uid, isCurrent);
      let fresh;
      try { fresh = await Promise.all([sdk.getDocFromServer(cloudRef), sdk.getDocFromServer(workRef), sdk.getDocFromServer(receiptRef)]); }
      catch (readError) { current(operation.uid, isCurrent); throw error; }
      current(operation.uid, isCurrent);
      const [newCloud, newMetadata, newReceipt] = fresh;
      const cloud = newCloud.exists() ? validateCloudRecord(newCloud.data(), { cloudKey: operation.cloudKey, workId: operation.workId }) : null;
      const metadata = newMetadata.exists() ? validateMetadata(newMetadata.data()) : null;
      if (newReceipt.exists()) validateReceipt(newReceipt.data(), operation);
      if ((cloud && !metadata) || (newReceipt.exists() && (!cloud || !metadata))) throw syncError('SYNC_INVALID_STATE');
      const advanced = metadata && metadata.revision > basis.metadataRevision
        && (!basis.cloudRevision || (cloud && cloud.serverRevision >= basis.cloudRevision));
      if (!advanced) throw error;
      planned = await transact();
    }
    current(operation.uid, isCurrent);
    if (planned.replayed) return Object.freeze({ cloud: planned.cloud, receipt: planned.receipt, metadata: planned.metadata });
    // Resolve the timestamp using the immutable receipt from the server. Failure
    // here is an ambiguous acknowledgement, safely retried with the same op ID.
    const confirmed = await sdk.getDocFromServer(receiptRef);
    current(operation.uid, isCurrent);
    if (!confirmed.exists()) throw syncError('SYNC_RECEIPT_MISMATCH');
    const receipt = validateReceipt(confirmed.data(), operation);
    if (receipt.resultRevision !== planned.cloud.serverRevision || receipt.metadataRevision !== planned.metadata.revision) throw syncError('SYNC_RECEIPT_MISMATCH');
    const cloud = validateCloudRecord({ ...planned.cloud, createdAt: planned.cloud.serverRevision === 1 ? receipt.createdAt : planned.cloud.createdAt, updatedAt: receipt.createdAt },
      { cloudKey: operation.cloudKey, workId: operation.workId });
    return Object.freeze({ cloud, receipt, metadata: planned.metadata });
  }

  function listen(uidOrScope, workOrNext, nextOrError, errorOrOptions, possibleOptions) {
    const objectScope = uidOrScope && typeof uidOrScope === 'object';
    const uid = objectScope ? uidOrScope.uid : uidOrScope, workId = objectScope ? uidOrScope.workId : workOrNext;
    const onRecords = objectScope ? workOrNext : nextOrError, onError = objectScope ? nextOrError : errorOrOptions;
    const options = (objectScope ? errorOrOptions : possibleOptions) || {};
    if (!pathPart(uid) || !pathPart(workId) || typeof onRecords !== 'function' || typeof onError !== 'function') throw syncError('SYNC_INVALID_OPERATION');
    let stopped = false, unsubscribe = null;
    const active = () => !stopped && env.auth.currentUser?.uid === uid && (!options.isCurrent || options.isCurrent() === true);
    function fail(error) { if (active()) onError(error); }
    // Return cancellation synchronously, including before readiness resolves.
    env.assertReady().then(() => {
      if (!active()) return;
      const query = sdk.query(sdk.collection(env.db, 'users', uid, 'highlightWorks', workId, 'highlights'), sdk.limit(MAX_LISTENER_DOCUMENTS + 1));
      unsubscribe = sdk.onSnapshot(query, snapshot => {
        if (!active()) return;
        try {
          if (!Array.isArray(snapshot.docs) || snapshot.docs.length > MAX_LISTENER_DOCUMENTS) throw syncError('SYNC_LISTENER_LIMIT');
          const records = Object.freeze(snapshot.docs.map(document => Object.freeze({ cloudKey: document.id,
            cloud: validateCloudRecord(document.data(), { cloudKey: document.id, workId }) })));
          if (active()) onRecords(records);
        } catch (error) { fail(error); }
      }, fail);
      if (!active() && unsubscribe) unsubscribe();
    }).catch(fail);
    return () => { stopped = true; if (unsubscribe) unsubscribe(); };
  }
  return Object.freeze({ commit, submit: commit, listen });
}

module.exports = { createFirestoreHighlightSyncTransport, MAX_LISTENER_DOCUMENTS };
