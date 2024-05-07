import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { PLAYS } from "../shared/playsRoot";

export const fetchFolgerCharacter = createAsyncThunk(
  "FolgerCharacter/fetchFolgerCharacter",
  async (id) => {
    const play = PLAYS.find((play) => play.id === id);
    if (!play) {
      throw new Error("Play not found");
    }
    const response = await fetch(
      `https://www.folgerdigitaltexts.org/${play.folgerURL}/parts/`
    );

    if (!response.ok) {
      throw new Error("Fetch failed with status: " + response.status);
    }
    const htmlTextCharacters = await response.text();
    return htmlTextCharacters;
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
