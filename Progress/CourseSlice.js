
import { createSlice } from "@reduxjs/toolkit";
import { FIRESTORE_DB, FIREBASE_AUTH } from "../firebaseConfig";
import { useSelector, useDispatch } from "react-redux";
import { addQuiz } from "../Progress/CourseSlice";

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
