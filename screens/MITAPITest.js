import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchMIT } from "../completeWorks/MITShakespeareSlice";
import { StyleSheet, SafeAreaView, ScrollView, Text } from "react-native";
import HTMLView from "react-native-htmlview";

const MITScreen = () => {
  const dispatch = useDispatch();
  const MITState = useSelector((state) => state.MIT);

  useEffect(() => {
    dispatch(fetchMIT());
  }, [dispatch]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        {MITState.isLoading ? (
          <Text>Loading...</Text>
        ) : MITState.errMess ? (
          <Text>Error: {MITState.errMess}</Text>
        ) : (
          <HTMLView value={MITState.htmlContent} stylesheet={htmlStyles} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const htmlStyles = StyleSheet.create({
  a: {
    fontWeight: "bold",
    color: "blue",
  },
  b: {
    fontWeight: "bold",
  },
  p: {
    color: "red",
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "white",
  },
  headerText: {
    fontSize: 24,
    marginBottom: 10,
  },
});

export default MITScreen;
