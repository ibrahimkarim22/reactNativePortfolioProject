import { useDispatch, useSelector } from "react-redux";
import { fetchMIT } from "../completeWorks/MITShakespeareSlice";
import { StyleSheet, SafeAreaView, ScrollView, Text, View } from "react-native";
import { useEffect } from "react";
import HTMLView from "react-native-htmlview";
import { fetchFolgerCharacter } from "../charactersList/FolgerCharacterList";
import { Button } from "react-native-elements";
import { useNavigation, useRoute } from "@react-navigation/native";

const ReadFolger = () => {
    const route = useRoute();
  const dispatch = useDispatch();
  const { id } = route.params;

  const MIT = useSelector((state) => state.MIT);
  const FolgerCharacter = useSelector((state) => state.FolgerCharacter);
  const navigation = useNavigation();

  useEffect(() => {

    dispatch(fetchMIT(id));
    dispatch(fetchFolgerCharacter(id));
  }, [dispatch, id]);

  return (
    <ScrollView style={styles.container}>
      
      {MIT.isLoading && FolgerCharacter.isLoading ? (
        <Text style={styles.message}>Loading...</Text>
      ) : MIT.errMess && FolgerCharacter.errMess ? (
        <Text style={styles.message}>Error: {MIT.errMess}</Text>
      ) : (
        <>
          <HTMLView
            value={FolgerCharacter.htmlContent}
            stylesheet={htmlStyles}
          />
          <HTMLView value={MIT.htmlContent} stylesheet={htmlStyles} />
        </>
      )}
    </ScrollView>
  );
};

const htmlStyles = StyleSheet.create({
  title: {
    color: "darkred",
    margin: 0,
  },
  a: {
    fontWeight: "bold",
    color: "white",
    fontFamily: "Sora_500Medium"
  },

  p: {
    color: "red",
  },
});

const styles = StyleSheet.create({
  message: {
    color: "red",
  },
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "black",
  },
  headerText: {
    fontSize: 24,
    marginBottom: 10,
  },
});

export default ReadFolger;
