import { configureStore } from "@reduxjs/toolkit";
import { folgerReducer } from "../folgerLibrary/folgerSlice";
import { MITReducer } from "../completeWorks/MITShakespeareSlice";

export const store = configureStore({
    reducer: {
       folger: folgerReducer,
       MIT: MITReducer
    }
})

