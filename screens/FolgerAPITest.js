import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import HTMLView from "react-native-htmlview";
import { useDispatch, useSelector } from "react-redux";
import { fetchFolger } from "../folgerLibrary/folgerSlice";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/playsRoot";

const Folger = () => {
  const dispatch = useDispatch();
  const folger = useSelector((state) => state.folger);

  useEffect(() => {
    dispatch(fetchFolger());
  }, [dispatch]);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.headerText}>Home Screen</Text>
      {folger.isLoading ? (
        <Text>Loading...</Text>
      ) : folger.errMess ? (
        <Text>Error: {folger.errMess}</Text>
      ) : (
        <HTMLView value={folger.htmlContent} stylesheet={htmlStyles} />
      )}
    </ScrollView>
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
    backgroundColor: "white",
    flex: 1,
    padding: 20,
  },
  headerText: {
    color: "white",
    fontSize: 24,
    marginBottom: 10,
  },
});

export default Folger;
