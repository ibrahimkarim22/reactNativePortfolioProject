
import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  quizzes: [],
};

const courseSlice = createSlice({
  name: "course",
  initialState,
  reducers: {
    setQuizzes(state, action) {
      state.quizzes = action.payload;
      console.log("QUIZZES STATE " + state.quizzes)
    },
  },
});

export const { setQuizzes } = courseSlice.actions;
export const courseReducer = courseSlice.reducer;
