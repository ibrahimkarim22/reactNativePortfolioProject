import AsyncStorage from "@react-native-async-storage/async-storage";
import { createNormalHighlightRuntime } from "./normalHighlightRuntime";
import { PRODUCTION_HIGHLIGHT_SYNC, createProductionHighlightEnvironment, createProductionHighlightSyncTransport } from "./highlightProductionEnvironment";
import { createMyHighlightsHandoff } from "./myHighlightsHandoff";
import { highlightOwner } from "./useHighlightOwner";

// One normal application adapter. The source-controlled default remains v1;
// production construction is lazy and separately guarded before Firebase IO.
export const normalHighlightRuntime = createNormalHighlightRuntime({
  storage: AsyncStorage,
  configuration: PRODUCTION_HIGHLIGHT_SYNC,
  createBackend: () => createProductionHighlightSyncTransport({ environment: createProductionHighlightEnvironment() }),
  resolveCanonical: workId => {
    if (typeof workId !== "string" || !workId.length) return null;
    const entry = require("../shared/localPlayService").getLocalPlayEntry(workId);
    return entry?.play?.id === workId ? require("../shared/contentText").buildCanonicalDocument(entry) : null;
  },
});
normalHighlightRuntime.acquireOwner = () => highlightOwner.acquire();
const updateOwner = () => {
  const owner = highlightOwner.getSnapshot();
  normalHighlightRuntime.setOwner(owner.ready ? owner.uid : null).catch(() => {});
};
highlightOwner.subscribe(updateOwner);
updateOwner();
export const normalHighlightManager = normalHighlightRuntime.manager;
export const normalMyHighlightsHandoff = createMyHighlightsHandoff({
  getOwner: highlightOwner.getSnapshot,
  subscribeOwner: highlightOwner.subscribe,
});
