import { configureStore } from "@reduxjs/toolkit";
import { folgerReducer } from "../folgerLibrary/folgerSlice";
import { MITReducer } from "../completeWorks/MITShakespeareSlice";
import { FolgerCharacterReducer } from "../charactersList/FolgerCharacterList";

export const store = configureStore({
    reducer: {
       folger: folgerReducer,
       MIT: MITReducer,
       FolgerCharacter: FolgerCharacterReducer
    }
})

