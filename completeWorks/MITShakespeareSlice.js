import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

export const fetchMIT = createAsyncThunk(
    'MIT/fetchMIT',
    async () => {
        const response = await fetch("https://raw.githubusercontent.com/TheMITTech/shakespeare/master/allswell/full.html");
        if (!response.ok) {
            throw new Error('Fetch failed with status: ' + response.status);
        }
        const htmlText = await response.text(); 
        return htmlText;
    } 
);

const MITSlice = createSlice({
    name: 'MIT',
    initialState: { isLoading: true, errMess: null, htmlContent: ''},
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(fetchMIT.pending, (state) => {
                state.isLoading = true;
            })
            .addCase(fetchMIT.fulfilled, (state, action) => {
                state.isLoading = false;
                state.errMess = null;
                state.htmlContent = action.payload;
            })
            .addCase(fetchMIT.rejected, (state, action) => {
                state.isLoading = false;
                state.errMess = action.error ? action.error.message : 'Fetch failed';
            });
    }
});

export const MITReducer = MITSlice.reducer;
