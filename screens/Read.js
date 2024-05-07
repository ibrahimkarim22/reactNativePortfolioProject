import { useDispatch, useSelector } from "react-redux";
import { fetchMIT } from "../completeWorks/MITShakespeareSlice";
import { StyleSheet, ScrollView, Text, ActivityIndicator } from "react-native";
import { useEffect } from "react";
import HTMLView from "react-native-htmlview";
import { fetchFolgerCharacter } from "../charactersList/FolgerCharacterList";
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
        <>
          <ActivityIndicator size="large" color="hotpink" />
          <Text style={styles.loadingMsg}>
            Fetching from Folger.. please wait..
          </Text>
        </>
      ) : MIT.errMess && FolgerCharacter.errMess ? (
        <>
          <ActivityIndicator size="large" color="hotpink" />
          <Text style={styles.loadingMsg}>
            Fetching from Folger.. please wait..
          </Text>
        </>
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
    fontFamily: "sans-serif-light",
    fontSize: 15,
  },

  p: {
    color: "red",
  },
});

const styles = StyleSheet.create({
  loadingMsg: {
    color: "hotpink",
    fontFamily: "monospace",
    textAlign: "center",
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
