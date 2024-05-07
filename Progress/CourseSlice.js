import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  completedLevel: 1,
};

const courseSlice = createSlice({
  name: "course",
  initialState,
  reducers: {
    setLevel(state, action) {
      state.completedLevel = action.payload;
      console.log("completedLevel REDUX STATE: " + state.completedLevel);
    },
    resetState(state) {
      state.completedLevel = initialState.completedLevel;
    },
  },
});
export const { setLevel, resetState } = courseSlice.actions;
export const courseReducer = courseSlice.reducer;
