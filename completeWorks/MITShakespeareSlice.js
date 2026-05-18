import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { getFullPlayHtml } from "../shared/localPlayService";

export const fetchMIT = createAsyncThunk("MIT/fetchMIT", async (id) => {
  return getFullPlayHtml(id);
});

const MITSlice = createSlice({
  name: "MIT",
  initialState: { isLoading: true, errMess: null, htmlContent: "" },
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
        state.errMess = action.error ? action.error.message : "Fetch failed";
      });
  },
});

export const MITReducer = MITSlice.reducer;
