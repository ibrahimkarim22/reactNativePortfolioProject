import { View, Text, StyleSheet, Alert } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/playsRoot";
import { Card, Button, Overlay } from "react-native-elements";
import { useRoute } from "@react-navigation/native";
import { useRef, useState } from "react";


const total = 7;

const QuizScreen = () => {
  const route = useRoute();
  const { id } = route.params;
  const play = PLAYS.find((play) => play.id === id);
  

  const [answer, setAnswer] = useState({});
  const [results, setResults] = useState(false);
  const [correctAnswers, setCorrectAnswers] = useState([]);
  const scroll = useRef();

  const handleAnswer = (qId, selectedOption) => {
    if (answer[qId]) {
      return;
    }

    const question = play.quiz.find((q) => q.id === qId);
    const isCorrect = selectedOption === question.correctAnswer;

    setAnswer((prevStatus) => ({
      ...prevStatus,
      [qId]: isCorrect ? "correct" : "wrong",
    }));
    if (isCorrect) {
        setCorrectAnswers((prevAnswers) => [...prevAnswers, qId])
    }
  };

  const submitQuiz = () => {
    if (answer.length < total) {
        Alert.alert("Please answer all questions before submitting")
    } else {
        setResults(true);
    }
  }

  const totalCorrectAnswers = correctAnswers.length;

  const handleRetakeQuiz = () => {
    setAnswer({});
    setCorrectAnswers([]);
    setResults(false);
    scroll.current.scrollTo({ x: 0, y: 0, animated: true });
  }
  const BtnColor = (qId, option) => {
    const selectedAnswer = answer[qId];
    const question = play.quiz.find((q) => q.id === qId);
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
            <Button 
                title="Submit"
                onPress={submitQuiz}
            />
        </View>
        <Overlay isVisible={results}>
            <View>
                <Text>
                    {`${totalCorrectAnswers}/${total}`}
                </Text>
                {totalCorrectAnswers === total && (
                    <Text>Congradulations! You can proceed to the next play.</Text>
                )}
            </View>
            <View>
                <Button 
                    title="Retake Quiz" 
                    onPress={handleRetakeQuiz}
                />
            </View>
            <View>
            <Button 
                    title="Course Menu" 
                    onPress={() => setResults(false)}
                />
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
