import { useDispatch, useSelector } from "react-redux";
import { fetchMIT } from "../completeWorks/MITShakespeareSlice";
import { StyleSheet, ScrollView, Text } from "react-native";
import { useEffect } from "react";
import HTMLView from "react-native-htmlview";
import { fetchFolgerCharacter } from "../charactersList/FolgerCharacterList";
import { useRoute } from "@react-navigation/native";
import Loader from "../Componenets/Loader";

const MITFullPlayScreen = () => {
  const route = useRoute();
  const { id } = route.params || {};
  const dispatch = useDispatch();
  const MIT = useSelector((state) => state.MIT);
  const FolgerCharacter = useSelector((state) => state.FolgerCharacter);

  useEffect(() => {
    dispatch(fetchMIT(id));
    dispatch(fetchFolgerCharacter(id));
  }, [dispatch, id]);

  return (
    <ScrollView style={styles.container}>
      {MIT.isLoading || FolgerCharacter.isLoading ? (
        <Loader
          label="Opening play"
          detail="Preparing the full text and dramatis personae"
        />
      ) : MIT.errMess ? (
        <Text style={styles.loadingMsg}>Unable to load this play.</Text>
      ) : (
        <>
          <HTMLView
            value={FolgerCharacter.htmlContent}
            stylesheet={htmlStyles}
            style={{ marginBottom: 122 }}
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

export default MITFullPlayScreen;
