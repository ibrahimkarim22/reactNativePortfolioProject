import { View, Text, StyleSheet, Alert } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/playsRoot";
import { Card, Button, Overlay } from "react-native-elements";
import { useRoute } from "@react-navigation/native";
import { useRef, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { completedQuizesArr, setQuizzes } from "../Progress/CourseSlice";
import { addQuiz } from "../Progress/CourseSlice";
import { getFirestore, collection, doc, setDoc, updateDoc } from "firebase/firestore";
import { FIRESTORE_DB, FIREBASE_AUTH } from "../firebaseConfig";

const total = 7;

const QuizScreen = () => {
  const dispatch = useDispatch();
  const route = useRoute();
  const { id } = route.params;
  const play = PLAYS.find((play) => play.id === id);
  console.log(play);

  const [answer, setAnswer] = useState({});
  const [results, setResults] = useState(false);
  const [correctAnswers, setCorrectAnswers] = useState([]);
  const scroll = useRef();

  const handleAnswer = (questionId, selectedOption) => {
    if (answer[questionId]) {
      console.log("id is matching you cant select it twice")
      return;
    }

    const question = play.quiz.find((q) => q.id === questionId);
    console.log(question);
    const isCorrect = selectedOption === question.correctAnswer;
    console.log(isCorrect);

    const prevStatus = () => {
      
    }

    setAnswer((prevStatus) => ({
      ...prevStatus,
      [questionId]: isCorrect ? "correct" : "wrong",
    }));
    if (isCorrect) {
      setCorrectAnswers((prevAnswers) => [...prevAnswers, questionId]);

    }
  };

  const totalCorrectAnswers = correctAnswers.length;

  console.log("Answer:", answer);


  const submitQuiz = async () => {
    if (Object.keys(answer).length < total) {
      Alert.alert("Please answer all questions before submitting");
    } else {
      const totalCorrect = correctAnswers.length;
      if (totalCorrect === total) {
        console.log("all questions answered correctly. submitting quiz...");
        setResults(true);
        dispatch(setQuizzes(play.difficulty)); 
        
        try {
          const db = getFirestore();
    
          const userRef = doc(FIRESTORE_DB, "users", FIREBASE_AUTH.currentUser.uid); 
          await updateDoc(userRef, {
            quizzes: play.difficulty, 
          });
          console.log("user data updated successfully with quiz difficulty.");
        } catch (error) {
          console.error("error updating user data:", error);
        }
        
        console.log("quiz submitted successfully!");
      } else {
        console.log("not all questions answered correctly quiz not submitted.");
        Alert.alert("please answer all questions correctly to submit the quiz.");
      }
    }
  };

  const handleRetakeQuiz = () => {
    setAnswer({});
    setCorrectAnswers([]);
    setResults(false);
    scroll.current.scrollTo({ x: 0, y: 0, animated: true });
  };
  const BtnColor = (questionId, option) => {
    const selectedAnswer = answer[questionId];
    const question = play.quiz.find((q) => q.id === questionId);
    const correctAnswer = question.correctAnswer;

    if (selectedAnswer === "wrong" && option !== correctAnswer) {
      return styles.wrongButton;
    } else if (selectedAnswer === "correct" && option === correctAnswer) {
      return styles.correctButton;
    }
    return styles.btn;
  };
  return (
    <ScrollView style={styles.main} ref={scroll}>
      <View>
        {play.quiz.map((question, index) => (
          <Card key={index}>
            <Card.Title>{question.question}</Card.Title>
            {question.options.map((option, optionIndex) => (
              <Button
                key={optionIndex}
                title={option}
                onPress={() => handleAnswer(question.id, option)}
                buttonStyle={BtnColor(question.id, option)}
              />
            ))}
          </Card>
        ))}
        <View>
          <Button title="Submit" onPress={submitQuiz} />
        </View>
        <Overlay isVisible={results}>
          <View>
            <Text>{`${totalCorrectAnswers}/${total}`}</Text>
            {totalCorrectAnswers === total && (
              <Text>Congradulations! You can proceed to the next play.</Text>
            )}
          </View>
          <View>
            <Button title="Retake Quiz" onPress={handleRetakeQuiz} />
          </View>
          <View>
            <Button title="Course Menu" onPress={() => setResults(false)} />
          </View>
        </Overlay>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  main: {
    backgroundColor: "black",
  },
  btn: {
    margin: 8,
  },
  wrongButton: {
    margin: 8,
    backgroundColor: "red",
  },
  correctButton: {
    margin: 8,
    backgroundColor: "green",
  },
});
export default QuizScreen;
