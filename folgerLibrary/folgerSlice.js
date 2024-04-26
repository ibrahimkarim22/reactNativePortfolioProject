import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { PLAYS } from "../shared/playsRoot";

export const fetchFolger = createAsyncThunk(
    'folger/fetchFolger',
    async (id) => {
        const play = PLAYS.find((play) => play.id === 1);
        if (!play) {
            throw new Error("Play not found");
        }
            const response = await fetch(`https://www.folgerdigitaltexts.org/${play.folgerURL}/synopsis/`);
            if (!response.ok) {
                throw new Error('Fetch failed with status: ' + response.status);
            }
            const htmlText = await response.text(); 
            return htmlText;
        } 
);

const folgerSlice = createSlice({
    name: 'folger',
    initialState: { isLoading: true, errMess: null, htmlContent: "" },
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(fetchFolger.pending, (state) => {
                state.isLoading = true;
            })
            .addCase(fetchFolger.fulfilled, (state, action) => {
                state.isLoading = false;
                state.errMess = null;
                state.htmlContent = action.payload;
            })
            .addCase(fetchFolger.rejected, (state, action) => {
                state.isLoading = false;
                state.errMess = action.error ? action.error.message : 'Fetch failed';
            });
    }
});

export const folgerReducer = folgerSlice.reducer;
