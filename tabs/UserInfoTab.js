import { View, Text, StyleSheet } from "react-native";
import { Button, Image } from "react-native-elements";
import { useNavigation } from "@react-navigation/native";
import { FIREBASE_AUTH } from "../firebaseConfig";

const auth = FIREBASE_AUTH;

const UserInfoTab = () => {
  const navigation = useNavigation();

  const Logout = (navigation) => {
    auth
      .signOut()
      .then(() => {
        navigation.navigate("Root");
      })
      .catch((error) => {
        console.error("Error logging out: ", error);
      });
  };
  return (
    <View style={styles.main}>
      <View>
        <Image
          style={styles.image}
          source={{
            uri: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s",
          }}
        />
      </View>
      <View style={styles.infoContainer}>
        <Text style={styles.usernameText}>Username</Text>
      </View>
      <View style={styles.infoTextContainer}>
        <Text style={styles.infoText}>Full Name</Text>
      </View>
      <View style={styles.editProfile}>
        <Text style={styles.editProfileText}>Edit Profile</Text>
        <Button title="Course" onPress={() => navigation.navigate("Root")} />
        <Button title="Logout" onPress={() => Logout(navigation)} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  main: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "black",
  },
  image: {
    width: 100,
    height: 100,
    borderRadius: 222,
    marginTop: 22,
  },
  infoContainer: {
    marginTop: 10,
  },
  usernameText: {
    color: "white",
    textAlign: "center",
    fontSize: 33,
  },
  infoTextContainer: {
    marginTop: 10,
  },
  infoText: {
    color: "white",
    textAlign: "center",
    fontSize: 22,
  },
  editProfile: {
    marginTop: 22,
  },
  editProfileText: {
    color: "white",
    fontSize: 18,
  },
});

export default UserInfoTab;
