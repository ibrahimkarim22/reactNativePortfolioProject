import { View, Text, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/playsRoot";
import { Card, Button } from "react-native-elements";
import { useRoute } from "@react-navigation/native";


const QuizScreen = () => {
    const route = useRoute();
    const { id } = route.params;
    const play = PLAYS.find((play) => play.id === id);
    console.log(id);
    console.log(play);
    return (
        <ScrollView style={styles.main}>
            <View>
                {play.quiz.map((question, index) => (
                    <Card>
                        <Card.Title>{question.question}</Card.Title>
                        {question.options.map((option, optionIndex) => (
                            <Button
                                key={optionIndex}
                                title={option}
                                onPress={() => console.log(option)}
                                buttonStyle={styles.Button}
                            />
                        ))}
                    </Card>
                ))}
            </View>
        </ScrollView>
    );
};

const styles =  StyleSheet.create({
    main: {
        backgroundColor: "black"
    },
    Button: {
        margin: 8
    }
})
export default QuizScreen;