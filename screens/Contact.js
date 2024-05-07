import { View, Text, StyleSheet } from "react-native";
import { Button } from "react-native-elements";
import { Linking } from "react-native"


const ContactScreen = () => {
    return (
        <View style={styles.main}>
            <Text style={styles.text}>Please let me know if you have any question or concerns @:</Text>
        
            <View style={styles.btn}>

            <Button onPress={() => Linking.openURL('mailto:hema_thechamp@yahoo.com') }
      title="hema_thechamp@yahoo.com" />
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    main: {
        flex: 1,
        backgroundColor: "black"
    },
    text: {
        color: "white",
        fontSize: 22,
        textAlign: "center"
    },
    btn: {
        margin: 22
    }
})

export default ContactScreen;
