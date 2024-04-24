import { View, Text, StyleSheet } from "react-native";
import { Image } from "react-native-elements";
import { ScrollView } from "react-native-gesture-handler";

const MedalsTab = () => {
  return (
    <ScrollView style={styles.main}> 
        <View style={styles.genreView}>
          <Text style={styles.genreText}>ROMANCES</Text>
        </View>
        <View style={styles.medalContainer}>
          <Image
            style={styles.medalImage}
            source={require("../assets/medalCollection/mAWW.png" )}
          />
          <Text style={styles.medalTitle}>All's Well {"\n"} ThatEnds Well</Text>
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
  medalImage: {
    width: 100,
    height: 100,
  },
  medalTitle: {
    color: "white",
  }
});

export default MedalsTab;
