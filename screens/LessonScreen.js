import { View, Text, StyleSheet, Button } from "react-native";
import HTMLView from "react-native-htmlview";
import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigation } from "@react-navigation/native";
import { fetchFolger } from "../folgerLibrary/folgerSlice";
import { fetchMIT } from "../completeWorks/MITShakespeareSlice";
import { fetchFolgerCharacter } from "../charactersList/FolgerCharacterList";
import { ScrollView } from "react-native-gesture-handler";
import { useRoute } from "@react-navigation/native";

const Lesson = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { id } = route.params;
  const dispatch = useDispatch();
  const folger = useSelector((state) => state.folger);

  const handleReadPlay = () => {
    dispatch(fetchMIT(id));
    dispatch(fetchFolgerCharacter(id));
    navigation.navigate("MIT");
  };

  const handleQuiz = () => {
    navigation.navigate("Quiz", { id: id });
  };

  useEffect(() => {
    dispatch(fetchFolger(id));
  }, [dispatch, id]);

  return (
    <ScrollView style={styles.container}>
      {folger.isLoading ? (
        <Text>Loading...</Text>
      ) : folger.errMess ? (
        <Text>Error: {folger.errMess}</Text>
      ) : (
        <HTMLView value={folger.htmlContent} stylesheet={htmlStyles} style={{ marginBottom: 122 }} />
      )}
      <View style={styles.readPlayBtn}>
        <Button
          title="Read Play"
          onPress={handleReadPlay}
          color={"rgba(124, 252, 0, .7)"}
        />
      </View>
      <View style={styles.quizBtn}>
        <Button
          title="Quiz"
          onPress={handleQuiz}
          color={"rgba(75, 0, 130, .9)"}
        />
        <View style={styles.menuBtn}>
          <Button
            title="Course Menu"
            onPress={() => navigation.navigate("Course")}
            color={"rgba(255, 192, 283, .7)"}
          />
        </View>
      </View>
    </ScrollView>
  );
};

const htmlStyles = StyleSheet.create({
  h2: {
    color: "steelblue",
    fontSize: 22,
    fontFamily: "sans-serif-light",
    marginTop: 12,
  },
  i: {
    fontFamily: "sans-serif-light",
  },
  p: {
    color: "snow",
    margin: 3,
    paddingBottom: 0,
    marginBottom: -88,
    fontFamily: "sans-serif-light",
    fontSize: 22,
  },
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: "black",
    flex: 1,
    padding: 20,
  },
  readPlayBtn: {
    marginBottom: 11,
    marginTop: 22,
  },
  quizBtn: {
    marginBottom: 11,
    marginTop: 11,
  },
  menuBtn: {
    marginBottom: 122,
    marginTop: 22,
  },
});

export default Lesson;
