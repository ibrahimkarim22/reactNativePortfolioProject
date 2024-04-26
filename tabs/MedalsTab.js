import { View, Text, StyleSheet } from "react-native";
import { Image } from "react-native-elements";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/playsRoot"

const MedalsTab = () => {
  return (
    <ScrollView style={styles.main}> 
        <View style={styles.genreView}>
          <Text style={styles.genreText}>ROMANCES</Text>
        </View>
        <View style={styles.medalContainer}>
          {PLAYS.map((play, index) => (
            <View key={index} style={styles.medalItem}>
          <Image
            style={styles.medalImage}
            source={play.medalImage}
          />
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
    margin: 33
  },
  medalImage: {
    width: 248,
    height: 222,
  },
  medalTitle: {
    color: "white",
    marginTop: -22,
    marginBottom: 11
  }
});

export default MedalsTab;
