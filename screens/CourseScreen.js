import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/playsRoot";
import { Image } from "react-native-elements";
import genreColors from "../Componenets/genreColors";
import { useNavigation } from "@react-navigation/native";

const Course = () => {
  const navigation = useNavigation();

  const plays = PLAYS.slice().sort((a, b) => a.difficulty - b.difficulty);

  const handleImageClick = (id) => {
    navigation.navigate("Lesson", { screen: "Lesson", params: { id: id } });

  }

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
            onPress={() => handleImageClick(play.id)}
            >
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
    color: "navy"
  },
  comedyText: {
    backgroundColor: "gold",
    color: "navy"
  },
  historyText: {
    backgroundColor: "steelblue",
    color: "navy"
  },
  tragedyText: {
    backgroundColor: "darkred",
    color: "navy"
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
});

export default Course;
