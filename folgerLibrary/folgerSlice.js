import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { folgerUrl } from "../shared/folgerUrl";

export const fetchFolger = createAsyncThunk(
    'folger/fetchFolger',
    async () => {
        const response = await fetch(folgerUrl + 'folger');
        if(!response.ok) {
            return Promise.reject(
                'Unable to fetch, status: ' + response.status
            );
        }
        const data = await response.json();
        return data;
    }
);

const folgerSlice = createSlice({
    name: 'folger',
    initialState: { isLoading: true, errMess: null, folgerArray: [] },
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(fetchFolger.pending, (state) => {
                state.isLoading = true;
            })
            .addCase(fetchFolger.fulfilled, (state, action) => {
                state.isLoading = false;
                state.errMess = null;
                state.folgerArray = action.payload;
            })
            .addCase(fetchFolger.rejected, (state, action) => {
                state.isLoading = false;
                state.errMess = action.error ? action.error.message : 'Fetch failed';
            });
    }
});

export const folgerReducer = folgerSlice.reducer;