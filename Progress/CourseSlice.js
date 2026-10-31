import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  completedLevel: 0,
  ownerId: null,
  generation: 0,
  status: "loading",
  error: null,
};

const courseSlice = createSlice({
  name: "course",
  initialState,
  reducers: {
    setLevel(state, action) {
      state.completedLevel = action.payload;
    },
    resetState(state) {
      state.completedLevel = initialState.completedLevel;
    },
    receiveAccountProgress(state, action) {
      const progress = action.payload;
      state.ownerId = progress.owner.uid;
      state.generation = progress.owner.generation;
      state.status = progress.status;
      state.error = progress.error;
      state.completedLevel = progress.status === "ready" ? progress.completedLevel : 0;
    },
  },
});
export const { setLevel, resetState, receiveAccountProgress } = courseSlice.actions;
export const courseReducer = courseSlice.reducer;
