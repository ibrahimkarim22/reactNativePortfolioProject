import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { folgerReducer } from "../folgerLibrary/folgerSlice";
import { MITReducer } from "../completeWorks/MITShakespeareSlice";
import { FolgerCharacterReducer } from "../charactersList/FolgerCharacterList";
import { courseReducer } from "../Progress/CourseSlice";

import {
  persistStore,
  persistCombineReducers,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
  persistReducer,
} from "redux-persist";
import AsyncStorage from "@react-native-async-storage/async-storage";
import autoMergeLevel1 from "redux-persist/lib/stateReconciler/autoMergeLevel1";

const rootReducer = combineReducers({
  folger: folgerReducer,
  MIT: MITReducer,
  FolgerCharacter: FolgerCharacterReducer,
  course: courseReducer,
});

const config = {
  key: "root",
  storage: AsyncStorage,
  debug: true,
  blacklist: ["course"],
  // Old installations have an unowned scalar in their persisted root. Keep
  // unrelated cached state, but restore course authority from the account.
  stateReconciler: (inbound, original, reduced, options) => {
    const { course: ignoredCourse, ...otherState } = inbound || {};
    return autoMergeLevel1(otherState, original, reduced, options);
  },
};

const persistedReducer = persistReducer(config, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});

export const persistor = persistStore(store);
