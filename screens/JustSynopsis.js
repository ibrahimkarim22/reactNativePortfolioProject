import { useDispatch, useSelector } from "react-redux";
import { StyleSheet, ScrollView, Text, ActivityIndicator } from "react-native";
import { useEffect } from "react";
import HTMLView from "react-native-htmlview";
import { useNavigation, useRoute } from "@react-navigation/native";
import { fetchFolger } from "../folgerLibrary/folgerSlice";

const Synopsis = () => {
  const route = useRoute();
  const dispatch = useDispatch();
  const { id } = route.params;
  const synopsis = useSelector((state) => state.folger);
  const navigation = useNavigation();

  useEffect(() => {
    dispatch(fetchFolger(id));
  }, [dispatch, id]);

  return (
    <ScrollView style={styles.container}>
      {synopsis.isLoading ? (
        <>
          <ActivityIndicator size="large" color="hotpink" />
          <Text style={styles.loadingMsg}>
            Fetching from Folger.. please wait..
          </Text>
        </>
      ) : synopsis.errMess ? (
        <>
          <ActivityIndicator size="large" color="hotpink" />
          <Text style={styles.loadingMsg}>
            Please Reload..
          </Text>
        </>
      ) : (
        <>
          <HTMLView
            value={synopsis.htmlContent}
            stylesheet={htmlStyles}
            style={{ marginBottom: 122 }}
          />
        </>
      )}
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

export default Synopsis;
