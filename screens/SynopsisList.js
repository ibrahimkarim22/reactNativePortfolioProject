import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/playsRoot";
import genreColors from "../Componenets/genreColors";
import { useNavigation } from "@react-navigation/native";
import lock from "../assets/images/lock.png";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";

const SynopsisList = () => {
  const navigation = useNavigation();

  const plays = PLAYS;

  const handleTitleClick = (id) => {
    navigation.navigate("Synopsis", { id: id });
  };

  return (
    <ScrollView style={styles.main}>
      <View style={styles.genreColors}>
        <Text style={styles.romanceText}>ROMANCE</Text>
        <Text style={styles.comedyText}>COMDEY</Text>
        <Text style={styles.historyText}>HISTORY</Text>
        <Text style={styles.tragedyText}>TRAGEDY</Text>
      </View>
      <View style={styles.imageMain}>
        {plays.map((play, index) => (
          <TouchableOpacity
            key={index}
            style={styles.imageContainer}
            onPress={() => handleTitleClick(play.id)}
          >
            <Text
              style={[
                styles.playTitle,
                { backgroundColor: genreColors(play.genre) },
              ]}
            >
              {play.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  main: {
    backgroundColor: "black",
    flex: 1,
    padding: 20,
  },
  genreColors: {
    margin: 22,
  },
  romanceText: {
    backgroundColor: "deeppink",
    color: "snow",
    textShadowColor: "rgba(0, 0, 0, 1)",
    textShadowOffset: { width: 0.8, height: 0.8 },
    textShadowRadius: 2,
    fontSize: 22,
  },
  comedyText: {
    backgroundColor: "green",
    color: "snow",
    textShadowColor: "rgba(0, 0, 0, 1)",
    textShadowOffset: { width: 0.8, height: 0.8 },
    textShadowRadius: 2,
    fontSize: 22,
  },
  historyText: {
    backgroundColor: "steelblue",
    color: "snow",
    textShadowColor: "rgba(0, 0, 0, 1)",
    textShadowOffset: { width: 0.8, height: 0.8 },
    textShadowRadius: 2,
    fontSize: 22,
  },
  tragedyText: {
    backgroundColor: "darkred",
    color: "snow",
    textShadowColor: "rgba(0, 0, 0, 1)",
    textShadowOffset: { width: 0.8, height: 0.8 },
    textShadowRadius: 2,
    fontSize: 22,
  },
  icons: {
    margin: 11,
  },
  iconsInfo: {
    color: "white",
  },
  mainImage: {
    borderRadius: 10,
    width: 350,
    height: 250,
    resizeMode: "cover",
  },
  playTitle: {
    color: "snow",
    textAlign: "center",
    marginBottom: 22,
    textShadowColor: "rgba(0, 0, 0, 1)",
    textShadowOffset: { width: 2, height: 0.4 },
    textShadowRadius: 1,
    fontSize: 22,
    fontFamily: "monospace",
  },
  lockImage: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 350,
    height: 250,
    zIndex: 1,
  },
});

export default SynopsisList;
