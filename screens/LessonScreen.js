import { View, Text, StyleSheet } from "react-native";
import HTMLView from "react-native-htmlview";
import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigation } from "@react-navigation/native";
import { fetchFolger } from "../folgerLibrary/folgerSlice";
import { fetchMIT } from "../completeWorks/MITShakespeareSlice";
import { fetchFolgerCharacter } from "../charactersList/FolgerCharacterList";
import { ScrollView } from "react-native-gesture-handler";
import { useRoute } from "@react-navigation/native";
import { Fonts } from "../Componenets/fonts";
import { Button } from "react-native-elements";

const Lesson = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { id } = route.params;
  const dispatch = useDispatch();
  const folger = useSelector((state) => state.folger);

  const handleReadPlay = () => {
    dispatch(fetchMIT(id));
    dispatch(fetchFolgerCharacter(id));
    navigation.navigate("MITFullPlay");
  };

  useEffect(() => {
    dispatch(fetchFolger(id));
  }, [dispatch, id]);

  const fontsLoaded = Fonts();

  if (!fontsLoaded) {
    return <Text>Loading...</Text>;
  }

  return (
    <ScrollView style={styles.container}>
      {folger.isLoading ? (
        <Text>Loading...</Text>
      ) : folger.errMess ? (
        <Text>Error: {folger.errMess}</Text>
      ) : (
        <HTMLView value={folger.htmlContent} stylesheet={htmlStyles} />
      )}
      <View style={styles.readPlayBtn}>
        <Button title="Read Play" onPress={handleReadPlay} />
      </View>
      <View style={styles.quizBtn}>
        <Button title="Quiz" />
        <View style={styles.menuBtn}>
          <Button
            title="Course Menu"
            onPress={() => navigation.navigate("Course")}
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
    fontFamily: "Khand_700Bold",
    marginTop: 12,
  },
  i: {
    fontFamily: "Khand_400Regular",
  },
  p: {
    color: "snow",
    margin: 3,
    paddingBottom: 0,
    marginBottom: -88,
    fontFamily: "Sora_500Medium",
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
