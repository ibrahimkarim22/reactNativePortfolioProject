import { View, Text, StyleSheet, StatusBar, Image, Button } from "react-native";
import FolgerMidsummer from "../assets/images/FolgerMidsummer.jpg";
import { ScreenWidth } from "react-native-elements/dist/helpers";
import { Icon } from "react-native-elements";
import { Fonts } from "../Componenets/fonts";

export const RootScreen = ({ navigation }) => {
  const fontsLoaded = Fonts();

  if (!fontsLoaded) {
    return <Text>Loading...</Text>;
  }
 

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <View>
        <Image style={styles.welcomeImage} source={FolgerMidsummer} />
      </View>
      <View>
        <Text style={styles.promoText}>
          Embark on a journey {"\n"} through the timelss world of Shakespeare
        </Text>
        <View>
          <Icon
            name="minus"
            type="font-awesome"
            color="white"
            style={{ marginTop: -4 }}
          />
        </View>
      </View>
      <Text style={styles.promoTextTwo}>
        Immerse yourself {"\n"} in the beauty of classic literature
      </Text>
      <Icon
        name="minus"
        type="font-awesome"
        color="white"
        style={{ marginTop: -4 }}
      />

      <View style={styles.infoContainer}>
        <Text style={styles.infoTextHeader}>
          38 Plays{" "}
          <Text style={styles.infoText}>
            ~ Explore the entire collection from the Bard of Avon.
          </Text>
        </Text>
        <Text style={styles.infoTextHeader}>
          38 Quizes <Text style={styles.infoText}>~ Test your knowledge.</Text>
        </Text>
        <Text style={styles.infoTextHeader}>
          38 Medals{" "}
          <Text style={styles.infoText}>
            ~ Earn Medals as you progress, showcasing your mastery.
          </Text>
        </Text>
        <Text style={styles.infoTextHeader}>
          Certificate{" "}
          <Text style={styles.infoText}>
            ~ Complete the course and earn a certificate to highlight your
            experience with all 38 plays. 100% free.
          </Text>
        </Text>
      </View>
      <View>
        <View style={{ paddingLeft: 33, paddingRight: 33, margin: 5, marginTop: -11 }}>
          <Button 
            title="Sign Up" 
            color="firebrick"
            onPress={() => navigation.navigate('SignUp')}
          ></Button>
        </View>
        <Text style={styles.quote}>
          {" "}
          "How far that little candle throws its beams! {"\n"}
          So shines a good deed in a weary world."{" "}
        </Text>
      </View>
      <View style={{ marginTop: 7 }}>
        <View style={{ paddingLeft: 33, paddingRight: 33, margin: 5 }}>
          <Button
            title="Login"
            onPress={() => navigation.navigate('Login')}
          ></Button>
        </View>
        <Text style={styles.quote}>
          {" "}
          "Give me my robe, put on my crown;{"\n"}I have Immortal longings in
          me."{" "}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "black",
  },
  welcomeImage: {
    resizeMode: "cover",
    height: 122,
    width: ScreenWidth,
    borderRadius: 11,
    marginTop: 22,
  },
  promoText: {
    color: "white",
    fontSize: 24,
    textAlign: "center",
    fontFamily: "Khand_400Regular",
    marginTop: 11,
  },
  promoTextTwo: {
    color: "white",
    fontSize: 24,
    textAlign: "center",
    fontFamily: "Khand_400Regular",
    marginTop: -3,
  },
  infoContainer: {
    padding: 22,
    marginTop: -28,
  },
  infoTextHeader: {
    color: "silver",
    fontSize: 20,
    fontFamily: "Khand_700Bold",
  },
  infoText: {
    color: "white",
    fontSize: 15,
    fontFamily: "Sora_500Medium",
  },
  quote: {
    color: "silver",
    fontFamily: "Sora_500Medium",
    textAlign: "center",
    marginTop: -4
  }
});
