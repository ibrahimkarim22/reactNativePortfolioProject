import { View, Text, StyleSheet, Alert } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/playsRoot";
import { Card, Button, Overlay } from "react-native-elements";
import { useRoute } from "@react-navigation/native";
import { useRef, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { setLevel } from "../Progress/CourseSlice";
import { doc, updateDoc } from "firebase/firestore";
import { FIRESTORE_DB, FIREBASE_AUTH } from "../firebaseConfig";
const total = 7;

const QuizScreen = () => {
  const dispatch = useDispatch();
  const route = useRoute();
  const { id } = route.params;
  const play = PLAYS.find((play) => play.id === id);
  const difficulty = play ? play.difficulty : null;
  console.log(play);

  const [answer, setAnswer] = useState({});
  const [results, setResults] = useState(false);
  const [correctAnswers, setCorrectAnswers] = useState([]);
  const scroll = useRef();

  const currentCompletedLevel = useSelector(
    (state) => state.course.completedLevel
  );
  console.log(
    "CURRENT COMPLETED LEVEL FROM useSelector: ----------------",
    currentCompletedLevel
  );

  const handleAnswer = (questionId, selectedOption) => {
    if (answer[questionId]) {
      console.log("ANSWER ID MATCHES YOU CANT SELECT IT TWICE");
      return;
    }

    const question = play.quiz.find((q) => q.id === questionId);
    console.log(question);
    const isCorrect = selectedOption === question.correctAnswer;
    console.log(isCorrect);

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
      setResults(true);
      if (totalCorrect === total) {
        console.log(
          "ALL ANSWERS WERE ANSWERED CORRECTLY ... SUBMMITING QUIZ ..."
        );

      
        const currentPlay = PLAYS.find((p) => p.id === id);

        if (!currentPlay) {
          console.warn("PLAY NOT FOUND", id);
          return;
        }

        // if quiz1 scored perfectly 1 + 1 = 2. 2 is next level so its fetching everything from that array including difficulty
        const nextPlay = PLAYS.find(
          (p) => p.difficulty === currentPlay.difficulty + 1
        );

        if (nextPlay) {
          console.log("nextPlay:-------------", nextPlay);
          //if the play exist make a new variable to hold the difficulty of the next level play that was found in nextPlay
          const newCompletedLevel = nextPlay.difficulty;
          console.log(
            "REDUX STATE FOR currentCompletedLevel:---------",
            currentCompletedLevel
          );
          console.log(
            "newCompletedLevel = nextPlay.difficulty; ----------",
            newCompletedLevel
          );

          // if next level difficulty 2 is higher than current completed level 1 which is fetched for new users proceed to update store and firestore
          if (newCompletedLevel > currentCompletedLevel) {
            //store and firestore for the user so completedLevel becomes 2 and next play is unlocked
            dispatch(setLevel(newCompletedLevel));
            console.log("setLevel DISPATCHED TO REDUX");
            try {
              const userRef = doc(
                FIRESTORE_DB,
                "users",
                FIREBASE_AUTH.currentUser.uid
              );
              await updateDoc(userRef, {
                completedLevel: newCompletedLevel,
              });
              console.log(
                "UPDATED THE completedLevel in FIRESTORE ",
                newCompletedLevel
              );
            } catch (error) {
              console.error("ERROR UPDATIG TO FIRESTORE:", error);
            }
          } else {
            console.log(
              "QUIZ FROM PREVIOUS LEVEL WAS RETAKEN completedLevel WILL NOT BE UPDATED IN STORE OR FIRESTORE"
            );
          }
        } else {
          console.log("nextPlay NOT FOUND");
        }

        console.log("QUIZ SUBMMITTED");
      } else {
        console.log("CANNOT SUBMIT QUIZ WITHOUT ANSWERING ALL THE QUESTIONS.");
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
            {totalCorrectAnswers !== total && (
              <Text>Answer all Questions correctly to unlock next play.</Text>
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
