import { View, Text, StyleSheet } from "react-native";
import { Button } from "react-native-elements";
import { Linking } from "react-native";

const ContactScreen = () => {
  return (
    <View style={styles.main}>
      <View style={styles.btn}>
        <Button
          buttonStyle={styles.btn}
          onPress={() => Linking.openURL("mailto:test@yahoo.com")}
          title="mail"
        />
      </View>
      <Text style={styles.text}>Ibrahim Karim</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  main: {
    flex: 1,
    backgroundColor: "black",
  },
  text: {
    color: "white",
    fontSize: 22,
    textAlign: "center",
    fontFamily: "serif",
    marginTop: 22,
  },
  btn: {
    margin: 22,
  },
});

export default ContactScreen;
