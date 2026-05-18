import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { getSynopsisHtml } from "../shared/localPlayService";

export const fetchFolger = createAsyncThunk(
  "folger/fetchFolger",
  async (id) => {
    return getSynopsisHtml(id);
  }
);

const folgerSlice = createSlice({
  name: "folger",
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
        state.errMess = action.error ? action.error.message : "Fetch failed";
      });
  },
});

export const folgerReducer = folgerSlice.reducer;
