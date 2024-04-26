import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchMIT } from "../completeWorks/MITShakespeareSlice";
import { StyleSheet, SafeAreaView, ScrollView, Text } from "react-native";
import HTMLView from "react-native-htmlview";

const MITScreen = () => {
  const dispatch = useDispatch();
  const MIT = useSelector((state) => state.MIT);

  useEffect(() => {
    dispatch(fetchMIT());
  }, [dispatch]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        {MIT.isLoading ? (
          <Text>Loading...</Text>
        ) : MIT.errMess ? (
          <Text>Error: {MIT.errMess}</Text>
        ) : (
          <HTMLView value={MIT.htmlContent} stylesheet={htmlStyles} />
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
