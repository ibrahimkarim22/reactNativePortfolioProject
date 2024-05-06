import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/playsRoot";
import genreColors from "../Componenets/genreColors";
import { useNavigation } from "@react-navigation/native";
import lock from "../assets/images/lock.jpg";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
;

const CourseScreen = () => {
  const navigation = useNavigation();

  const completed = useSelector((state) => state.course.completedLevel)
 
  const plays = PLAYS.slice().sort((a, b) => a.difficulty - b.difficulty);

  useEffect(() => {
    console.log("COMPLETED LEVEL FROM REDUX " +  completed)
  }, [])


  const handleImageClick = (id) => {
    navigation.navigate("Lesson", { id: id });
  };
  


  return (
    <ScrollView style={styles.main}>
      
      <View style={styles.genreColors}>
        <Text style={styles.romanceText}>ROMANCE</Text>
        <Text style={styles.comedyText}>COMDEY</Text>
        <Text style={styles.historyText}>HISTORY</Text>
        <Text style={styles.tragedyText}>TRAGEDY</Text>
      </View>
      <View style={styles.icons}>
        <Text style={styles.iconsInfo}>Locked</Text>
      </View>
      <View style={styles.imageMain}>
        {plays.map((play, index) => (
          <TouchableOpacity
            key={index}
            style={styles.imageContainer}
            onPress={() => handleImageClick(play.id, completed)}
            disabled={play.difficulty > completed}
            >
              {play.difficulty > completed && (
              <Image
                source={require("../assets/images/lock.jpg")}
                style={styles.lockImage}
                onError={(error) => console.log("Image loading error:", error)}
             
              />
            )}
            <Image source={play.mainImage} style={styles.mainImage} />


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
    color: "navy",
  },
  comedyText: {
    backgroundColor: "gold",
    color: "navy",
  },
  historyText: {
    backgroundColor: "steelblue",
    color: "navy",
  },
  tragedyText: {
    backgroundColor: "darkred",
    color: "navy",
  },
  icons: {
    margin: 11,
  },
  iconsInfo: {
    color: "white",
  },
  imageMain: {},
  imageContainer: {},
  mainImage: {
    borderRadius: 10,
    width: 350,
    height: 250,
    resizeMode: "cover",
  },
  playTitle: {
    color: "black",
    textAlign: "center",
    marginBottom: 22,
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

export default CourseScreen;
