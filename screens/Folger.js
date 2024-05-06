import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { PLAYS } from "../shared/playsRoot";
import genreColors from "../Componenets/genreColors";
import { useNavigation } from "@react-navigation/native";



const FreeFolger = () => {

    const navigation = useNavigation();
    const plays = PLAYS;

    const handleTitleCLick = (id) => {
    navigation.navigate("ReadFolger", { id: id })
    
}

return (
    <ScrollView style={styles.main}>
      
      <View style={styles.genreColors}>
        <Text style={styles.romanceText}>ROMANCE</Text>
        <Text style={styles.comedyText}>COMDEY</Text>
        <Text style={styles.historyText}>HISTORY</Text>
        <Text style={styles.tragedyText}>TRAGEDY</Text>
      </View>
      <View>
        {plays.map((play, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => handleTitleCLick(play.id)}
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
        flex: 1
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
      playTitle: {
        color: "black",
        textAlign: "center",
        marginBottom: 22,
      },
})

export default FreeFolger;


