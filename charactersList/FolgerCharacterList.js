import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { getCharactersHtml } from "../shared/localPlayService";

export const fetchFolgerCharacter = createAsyncThunk(
  "FolgerCharacter/fetchFolgerCharacter",
  async (id) => {
    return getCharactersHtml(id);
  }
);

const FolgerCharacterSlice = createSlice({
  name: "FolgerCharacter",
  initialState: { isLoading: true, errMess: null, htmlContent: "" },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchFolgerCharacter.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchFolgerCharacter.fulfilled, (state, action) => {
        state.isLoading = false;
        state.errMess = null;
        state.htmlContent = action.payload;
      })
      .addCase(fetchFolgerCharacter.rejected, (state, action) => {
        state.isLoading = false;
        state.errMess = action.error ? action.error.message : "Fetch failed";
      });
  },
});

export const FolgerCharacterReducer = FolgerCharacterSlice.reducer;
