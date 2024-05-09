import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Image } from "react-native-elements";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/playsRoot";
import { useSelector } from "react-redux";

const MedalsTab = () => {
  const completedLevel = useSelector((state) => state.course.completedLevel);

  const plays = PLAYS.slice().sort((a, b) => a.difficulty - b.difficulty);

  return (
    <ScrollView style={styles.main}>
      <View style={styles.medalContainer}>
        {plays.map((play, index) => (
          <View key={index} style={styles.medalItem}>
            <View style={styles.imageContainer}>
              <Image source={play.medalImage} style={styles.medalImage} />
              {play.difficulty > completedLevel - 1 && (
                <View style={styles.blurContainer}>
                  <Image
                    source={require("../assets/images/lock.png")}
                    style={styles.lock}
                    onError={(error) =>
                      console.log("Image loading error:", error)
                    }
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
  medalContainer: {
    padding: 2,
  },
  medalItem: {
    alignItems: "center",
    marginBottom: 22,
  },
  medalImage: {
    width: 333,
    padding: 200,
  },
  imageContainer: {
    position: "relative",
  },
  blurContainer: {
    position: "absolute",
    top: 0,
    left: 38,
    width: 333,
    height: 222,
    zIndex: 1,
  },
  medalTitle: {
    color: "rgba(255, 255, 255, .6)",
    fontFamily: "serif",
    fontSize: 22,
    textShadowColor: "rgba(255, 250, 250, 1)",
    textShadowOffset: { width: 0.8, height: 0.8 },
    textShadowRadius: 10,
    marginTop: -55,
  },
  lock: {
    width: 444,
    height: 322,
    left: -59,
  },
});

export default MedalsTab;
