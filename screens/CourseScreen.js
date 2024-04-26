import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, InteractionManager } from "react-native";
import HTMLView from "react-native-htmlview";
import { useDispatch, useSelector } from "react-redux";
import { fetchFolger } from "../folgerLibrary/folgerSlice";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/playsRoot";
import { Image } from "react-native-elements";

const Course = () => {

    const plays = PLAYS.slice().sort((a, b) => a.difficulty - b.difficulty);

  return (
    <ScrollView style={styles.main}>
      <View style={styles.genreColors}>
        <Text style={styles.genreText}>ROMANCE</Text>
      </View>
      <View style={styles.icons}>
        <Text style={styles.iconsInfo}>Locked</Text>
      </View>
      <View style={styles.imageMain}>
        {plays.map((play, index) => (
          <View key={index} style={styles.imageContainer}>
            <Image source={play.mainImage} style={styles.mainImage} />
            <Text style={styles.imageTitle}>{play.name}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  main: {
    backgroundColor: "black",
    flex: 1,
    padding: 20
  },
  genreColors: {
    margin: 22
  },
  genreText: {
    color: "white"
  },
  icons: {
    margin: 11
  },
  iconsInfo: {
    color: "white"
  },
  imageMain: {
   
  },
  imageContainer: {

  },
  mainImage: {
    borderRadius: 10,
    width: 350,
    height: 250,
    resizeMode: "cover",
  
  },
  imageTitle: {
    color: "white",
    textAlign: "center",
    marginBottom: 22
  }
});

export default Course;
