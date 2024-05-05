
import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  quizzes: [],
  completedQuizzes: []
};

const courseSlice = createSlice({
  name: "course",
  initialState,
  reducers: {
    setQuizzes(state, action) {
      state.quizzes = action.payload;
      console.log("QUIZZES STATE " + state.quizzes)
    },
    setCompletedQuizzes(state, action) {
      const { difficulty } = action.payload;
      state.completedQuizzes.push(difficulty);
      }
  },
});

export const { setQuizzes, setCompletedQuizzes } = courseSlice.actions;
export const courseReducer = courseSlice.reducer;
