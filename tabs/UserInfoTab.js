import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Button, Image, Overlay } from "react-native-elements";
import { useNavigation } from "@react-navigation/native";
import { FIREBASE_AUTH } from "../firebaseConfig";
import { FIRESTORE_DB } from "../firebaseConfig";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { useState, useEffect } from "react";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library";
import { updateProfile } from "firebase/auth";


const auth = FIREBASE_AUTH;

const UserInfoTab = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState(
    ""
  );
  
  
  const [overlayVisible, setOverlayVisible] = useState(false);

  const currentUser = auth.currentUser;

  useEffect(() => {
    const fetchProfileImage = async () => {
      try {
        const db = FIRESTORE_DB;
        const userRef = doc(db, "users", auth.currentUser.uid);
        const userSnapshot = await getDoc(userRef);

        if (userSnapshot.exists()) {
          const userData = userSnapshot.data();
          if (userData.profileImage) {
            setImageUrl(userData.profileImage); 
          } else {
            setImageUrl("https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s")
          }
        }
      } catch (error) {
        console.error("Error fetching profile image:", error);
      }
    };

    fetchProfileImage();
  }, []);

  const getImageFromCamera = async () => {
    const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
    if (cameraPermission.status === "granted") {
      setOverlayVisible(false)
      const capturedImage = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (capturedImage.assets) {
        console.log(capturedImage.assets[0]);
        processImage(capturedImage.assets[0].uri);

        await updateProfile(auth.currentUser, {
          photoURL: capturedImage.assets[0].uri,
        });
      }
    }
  };

  const getImageFromGallery = async () => {
    const mediaLibraryPermissions =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (mediaLibraryPermissions.status === "granted") {
      setOverlayVisible(false)
      const capturedImage = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (capturedImage) {
        console.log(capturedImage.assets[0]);
        processImage(capturedImage.assets[0].uri);
        await updateProfile(auth.currentUser, {
          photoURL: capturedImage.assets[0].uri,
        });
        
      }
    }
  };

  const processImage = async (imgUri) => {
    try {
      const processedImage = await ImageManipulator.manipulateAsync(
        imgUri,
        [{ resize: { width: 400 } }],
        { format: "png" }
      );
      console.log(processedImage);
      setImageUrl(processedImage.uri);
      await MediaLibrary.saveToLibraryAsync(processedImage.uri);
  
      const db = FIRESTORE_DB;
      const userRef = doc(db, "users", FIREBASE_AUTH.currentUser.uid); 
      await setDoc(userRef, {
        profileImage: processedImage.uri,
      });
      console.log("Profile image updated successfully:", processedImage.uri);
    } catch (error) {
      console.error("Error processing or saving image:", error);
    }
  };
  
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
        <View style={{ alignContent: "center", alignItems: "center" }}>
          {imageUrl ? (

            <Image source={{ uri: imageUrl }} style={styles.image} />
          ) : (
            <Image source={{ uri: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s" }} 
              style={styles.image} 
              />
          )}
        </View>
        <View style={styles.editButtons}>
        <Button title="Edit" onPress={() => setOverlayVisible(true)} />
      </View>
      </View>
      <View style={styles.infoContainer}>
        <Text style={styles.usernameText}>
          {" "}
          {currentUser ?.displayName || "loading"}
        </Text>
      </View>
      <View style={styles.infoTextContainer}>
        <Text style={styles.infoText}>
          {currentUser ?.email || "loading"}
        </Text>
      </View>
      <View style={styles.editProfile}>
        <Button title="Logout" onPress={() => Logout(navigation)} />
      </View>
      <Overlay
        isVisible={overlayVisible}
        onBackdropPress={() => setOverlayVisible(false)}
        overlayStyle={styles.overlay}
      >
        <View>
          <TouchableOpacity style={styles.overlayButton} onPress={getImageFromCamera}>
            <Text>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.overlayButton} onPress={getImageFromGallery}>
            <Text>Choose from Library</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.overlayButton} onPress={() => setOverlayVisible(false)}>
            <Text>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Overlay>
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
    width: 200,
    height: 200,
    borderRadius: 222,
    marginTop: 22,
  },
  infoContainer: {
    marginTop: 10,
  },
  usernameText: {
    color: "white",
    textAlign: "center",
    fontSize: 18,
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
  overlay: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
    width: '80%',
  },
  overlayButton: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
});

export default UserInfoTab;
