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
