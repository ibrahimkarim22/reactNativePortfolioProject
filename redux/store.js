import { configureStore } from "@reduxjs/toolkit";
import { folgerReducer } from "../folgerLibrary/folgerSlice";

export const store = configureStore({
    reducer: {
       folger: folgerReducer,
    }
})

