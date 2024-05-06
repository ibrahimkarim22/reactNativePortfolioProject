import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Image } from "react-native-elements";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/playsRoot"
import { useSelector } from "react-redux";
import { BlurView } from 'expo-blur';

const MedalsTab = () => {

  const completedLevel = useSelector((state) => state.course.completedLevel);

  const plays = PLAYS.slice().sort((a, b) => a.difficulty - b.difficulty);

  return (
    <ScrollView style={styles.main}> 
        <View style={styles.genreView}>
          <Text style={styles.genreText}>ROMANCES</Text>
        </View>
        <View style={styles.medalContainer}>
          {plays.map((play, index) => (
            <View key={index} style={styles.medalItem}>
              <View style={styles.imageContainer}>
                <Image
                  source={play.medalImage}
                  style={styles.medalImage}
                />
                {play.difficulty > completedLevel && (
                  <View style={styles.blurContainer}>
                   <Image
                   source={require("../assets/images/lock.jpg")}
                   style={styles.lock}
                   onError={(error) => console.log("Image loading error:", error)}
                 />
                 </View>
                )}
              </View>
              <Text style={styles.medalTitle}>{play.name}</Text>
            </View>
          ))}
        </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  main: {
    flex: 1,
    backgroundColor: "black",
  },
  genreView: {
    marginTop: 11,
  },
  genreText: {
    color: "white",
    fontSize: 22,
    textAlign: "center",
    marginTop: 22
  },
  medalContainer: {
    marginTop: 5,
    margin: 28
  },
  medalItem: {
    alignItems: "center",
    margin: 33,
  },
  medalImage: {
    width: 248,
    height: 222,
  },
  imageContainer: {
    position: "relative",
  },
  blurContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 248,
    height: 222,
    zIndex: 1,
  },
  medalTitle: {
    color: "white",
    marginTop: -22,
    marginBottom: 11
  },
  lock: {
    width: 234,
    height: 234
  }
});


export default MedalsTab;
