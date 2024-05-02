import { useDispatch, useSelector } from "react-redux";
import { fetchMIT } from "../completeWorks/MITShakespeareSlice";
import { StyleSheet, SafeAreaView, ScrollView, Text, View } from "react-native";
import { useEffect } from "react";
import HTMLView from "react-native-htmlview";
import { fetchFolgerCharacter } from "../charactersList/FolgerCharacterList";
import { Button } from "react-native-elements";
import { useNavigation } from "@react-navigation/native";

const MITFullPlayScreen = () => {
  const dispatch = useDispatch();
  const MIT = useSelector((state) => state.MIT);
  const FolgerCharacter = useSelector((state) => state.FolgerCharacter);
  const navigation = useNavigation();

  useEffect(() => {
    dispatch(fetchMIT());
    dispatch(fetchFolgerCharacter());
  }, [dispatch]);

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
          <View>
            <Button
              title="Go Back to Lesson"
              onPress={() => navigation.navigate("Lesson")}
            />
          </View>
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

export default MITFullPlayScreen;
