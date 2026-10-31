import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { getLocalSynopsis, getSynopsisHtml } from "../shared/localPlayService";

export const fetchFolger = createAsyncThunk(
  "folger/fetchFolger",
  async (id) => {
    return { synopsis: getLocalSynopsis(id), htmlContent: getSynopsisHtml(id) };
  }
);

const folgerSlice = createSlice({
  name: "folger",
  initialState: { isLoading: false, errMess: null, htmlContent: "", synopsis: null,
    requestedId: null, requestId: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchFolger.pending, (state, action) => {
        state.isLoading = true;
        state.requestId = action.meta.requestId;
        state.requestedId = String(action.meta.arg ?? "");
        state.synopsis = null;
        state.htmlContent = "";
        state.errMess = null;
      })
      .addCase(fetchFolger.fulfilled, (state, action) => {
        if (state.requestId !== action.meta.requestId) return;
        state.isLoading = false;
        state.errMess = null;
        state.htmlContent = action.payload.htmlContent;
        state.synopsis = action.payload.synopsis;
      })
      .addCase(fetchFolger.rejected, (state, action) => {
        if (state.requestId !== action.meta.requestId) return;
        state.isLoading = false;
        state.errMess = "Synopsis unavailable for this play.";
        state.synopsis = null;
        state.htmlContent = "";
      });
  },
});

export const folgerReducer = folgerSlice.reducer;
