import { View, Text, StyleSheet, StatusBar, Image } from "react-native";
import FolgerMidsummer from "../assets/images/FolgerMidsummer.jpg";
import { ScreenWidth } from "react-native-elements/dist/helpers";
import {
  Khand_300Light,
  Khand_400Regular,
  Khand_500Medium,
  Khand_600SemiBold,
  Khand_700Bold,
} from "@expo-google-fonts/khand";
import { useFonts } from "@expo-google-fonts/khand";
import { Icon } from 'react-native-elements';

export const Welcome = () => {
  const [fontsLoaded] = useFonts({
    Khand_300Light,
    Khand_400Regular,
    Khand_500Medium,
    Khand_600SemiBold,
    Khand_700Bold,
  });

  if (!fontsLoaded) {
    return <Text>Loading...</Text>;
  }

  return (
    <View style={styles.container}>
      <View>
        <Image style={styles.welcomeImage} source={FolgerMidsummer} />
      </View>
      <View>
        <Text style={styles.promoText}>
          Embark on a journey {'\n'} through the timelss world of Shakespeare
        </Text>
      <View>
        <Icon 
          name= 'heart'
          type='font-awesome'
          color='white'
          style={{ marginTop: 5 }}
        />
      </View>
      </View>
        <Text style={styles.promoText}>
          Immerse yourself {'\n'} in the beauty of classic literature
        </Text>
      <StatusBar style="auto" />
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
  line: {
    borderBottomColor: 'white',
    borderBottomWidth: StyleSheet.hairlineWidth,
    width: 122 
  }
});
