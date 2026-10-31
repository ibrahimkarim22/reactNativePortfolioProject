import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import {
  faAward,
  faBookOpen,
  faCamera,
  faCertificate,
  faChevronRight,
  faCrown,
  faImage,
  faRightFromBracket,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { updateProfile } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { useAccountCourseProgress, retryAccountProgress } from "../course/AccountCourseProgress";
import { CourseProgressNotice } from "../course/CourseProgressNotice";
import MedalsCollection from "../course/MedalsCollection";
import { getMedalCollection } from "../course/medalCollection";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import { FIREBASE_AUTH, FIRESTORE_DB } from "../firebaseConfig";
import { PLAYS } from "../shared/localPlayService";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const defaultProfileImage =
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPqyKSgl0SqQ6kxcklpXJgijs3B_E212kVuvKxG-OeGQ&s";

const tabs = ["Overview", "Medals", "Certificate"];

const HomeScreen = ({ navigation, route }) => {
  const [activeTab, setActiveTab] = useState(() => route?.params?.tab === "Medals" ? "Medals" : "Overview");
  const [imageUrl, setImageUrl] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const accountProgress = useAccountCourseProgress();
  const completedLevel = accountProgress.completedLevel;
  const currentUser = FIREBASE_AUTH.currentUser;

  const plays = useMemo(
    () => PLAYS.slice().sort((a, b) => a.difficulty - b.difficulty),
    []
  );

  const collection = getMedalCollection(plays, completedLevel);
  const totalPlays = collection.total;
  const completedPlays = collection.earnedCount;
  const confirmedLevel = Number.isSafeInteger(completedLevel) && completedLevel >= 0 ? completedLevel : 0;
  const nextUnlockedLevel = Math.min(Math.max(...plays.map(play => play.difficulty)), confirmedLevel + 1);
  const medalCount = completedPlays;
  const progress = collection.completion;
  const nextPlay =
    plays.find((play) => play.difficulty === nextUnlockedLevel) || plays[0];
  const isCompact = width < 360;
  const horizontalPadding = isCompact ? 14 : 18;
  const avatarSize = isCompact ? 78 : 94;

  useEffect(() => {
    if (route?.params?.tab !== "Medals") return;
    setActiveTab("Medals");
    navigation.setParams?.({ tab: undefined });
  }, [route?.key, route?.params?.tab, navigation]);

  useEffect(() => {
    const user = FIREBASE_AUTH.currentUser;
    setImageUrl(user?.photoURL || defaultProfileImage);
  }, []);

  const processImage = async (imgUri) => {
    try {
      setImageLoading(true);
      const processedImage = await ImageManipulator.manipulateAsync(
        imgUri,
        [{ resize: { width: 400 } }],
        { format: "png" }
      );

      setImageUrl(processedImage.uri);
      await MediaLibrary.saveToLibraryAsync(processedImage.uri);

      if (FIREBASE_AUTH.currentUser) {
        await updateProfile(FIREBASE_AUTH.currentUser, {
          photoURL: processedImage.uri,
        });

        const userRef = doc(
          FIRESTORE_DB,
          "users",
          FIREBASE_AUTH.currentUser.uid
        );
        await updateDoc(userRef, {
          profileImage: processedImage.uri,
        });
      }
    } catch (error) {
      console.error("Error processing or saving image:", error);
    } finally {
      setImageLoading(false);
      setImageModalVisible(false);
    }
  };

  const getImageFromCamera = async () => {
    const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
    if (cameraPermission.status !== "granted") return;

    const capturedImage = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (capturedImage.assets?.[0]?.uri) {
      await processImage(capturedImage.assets[0].uri);
    }
  };

  const getImageFromGallery = async () => {
    const mediaLibraryPermissions =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (mediaLibraryPermissions.status !== "granted") return;

    const capturedImage = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (capturedImage.assets?.[0]?.uri) {
      await processImage(capturedImage.assets[0].uri);
    }
  };

  const logout = () => {
    FIREBASE_AUTH.signOut()
      .then(() => navigation.navigate("Root"))
      .catch((error) => console.error("Error logging out: ", error));
  };

  const renderOverview = () => (
    <View style={[styles.section, { paddingHorizontal: horizontalPadding }]}>
      <View style={styles.coursePanel}>
        <View style={styles.panelHeader}>
          <View>
            <Text style={styles.panelEyebrow}>
              {progress >= 1 ? "Course complete" : "Current play"}
            </Text>
            <Text style={styles.panelTitle}>
              {progress >= 1 ? "All plays completed" : nextPlay?.name || "BARD"}
            </Text>
          </View>
          <View style={styles.levelBadge}>
            <Text style={styles.levelBadgeText}>{nextUnlockedLevel}</Text>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {Math.round(progress * 100)}% complete
        </Text>
      </View>

      <View style={styles.actionGrid}>
        <DashboardAction
          icon={faCrown}
          label="Continue Course"
          onPress={() => navigation.navigate("Course")}
        />
        <DashboardAction
          icon={faBookOpen}
          label="Read Plays"
          onPress={() => navigation.navigate("FreeFolger")}
        />
      </View>
    </View>
  );

  const renderMedals = () => <MedalsCollection plays={plays} completedLevel={completedLevel}
    onOpenLesson={play => navigation.navigate("Lesson", { id: play.id })} />;

  const renderCertificate = () => (
    <View style={[styles.section, { paddingHorizontal: horizontalPadding }]}>
      <View style={styles.certificatePanel}>
        <View style={styles.certificateIcon}>
          <FontAwesomeIcon icon={faCertificate} size={28} color="#d8bd73" />
        </View>
        <Text style={styles.certificateTitle}>
          {progress >= 1 ? "Certificate ready" : "Certificate in progress"}
        </Text>
        <Text style={styles.certificateText}>
          Complete all {totalPlays} plays to unlock the final course certificate.
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>{Math.round(progress * 100)}% complete</Text>
      </View>
    </View>
  );

  if (accountProgress.status !== "ready") return <CourseProgressNotice status={accountProgress.status} onRetry={retryAccountProgress} />;
  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom + 28, 44) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { padding: horizontalPadding }]}>
          <View style={styles.profileRow}>
            <View style={[styles.avatarWrap, { height: avatarSize, width: avatarSize }]}>
              <Image
                source={{ uri: imageUrl || defaultProfileImage }}
                style={[
                  styles.avatar,
                  {
                    borderRadius: avatarSize / 2,
                    height: avatarSize,
                    width: avatarSize,
                  },
                ]}
              />
              <Pressable
                onPress={() => setImageModalVisible(true)}
                style={styles.cameraButton}
              >
                {imageLoading ? (
                  <ActivityIndicator size="small" color="#130f0b" />
                ) : (
                  <FontAwesomeIcon icon={faCamera} size={13} color="#130f0b" />
                )}
              </Pressable>
            </View>
            <View style={styles.profileCopy}>
              <Text style={styles.welcome}>Welcome back</Text>
              <Text
                style={[styles.userName, isCompact && styles.compactUserName]}
                numberOfLines={1}
              >
                {currentUser?.displayName || "Reader"}
              </Text>
              <Text style={styles.userEmail} numberOfLines={1}>
                {currentUser?.email || "BARD member"}
              </Text>
            </View>
          </View>

          <View style={styles.metricsRow}>
            <Metric value={completedPlays} label="completed" />
            <Metric value={medalCount} label="medals" />
            <Metric value={`${Math.round(progress * 100)}%`} label="course" />
          </View>
        </View>

        <View style={[styles.tabRow, { paddingHorizontal: horizontalPadding }]}>
          {tabs.map((tab) => (
            <Pressable
              key={tab}
              accessibilityRole="tab"
              accessibilityLabel={tab}
              accessibilityState={{ selected: activeTab === tab }}
              onPress={() => setActiveTab(tab)}
              style={[
                styles.tabButton,
                activeTab === tab && styles.activeTabButton,
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab && styles.activeTabText,
                ]}
              >
                {tab}
              </Text>
            </Pressable>
          ))}
        </View>

        {activeTab === "Overview" && renderOverview()}
        {activeTab === "Medals" && renderMedals()}
        {activeTab === "Certificate" && renderCertificate()}

        <Pressable onPress={logout} style={styles.logoutButton}>
          <FontAwesomeIcon icon={faRightFromBracket} size={15} color="#e7ddd0" />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={imageModalVisible}
        onRequestClose={() => setImageModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalPanel}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Update profile picture</Text>
              <Pressable
                onPress={() => setImageModalVisible(false)}
                style={styles.modalClose}
              >
                <FontAwesomeIcon icon={faXmark} size={16} color="#f4efe7" />
              </Pressable>
            </View>
            <ModalAction
              icon={faCamera}
              label="Take Photo"
              onPress={getImageFromCamera}
            />
            <ModalAction
              icon={faImage}
              label="Choose from Library"
              onPress={getImageFromGallery}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const Metric = ({ value, label }) => (
  <View style={styles.metric}>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>
);

const DashboardAction = ({ icon, label, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      styles.dashboardAction,
      pressed && styles.pressed,
    ]}
  >
    <View style={styles.actionIcon}>
      <FontAwesomeIcon icon={icon} size={16} color="#d8bd73" />
    </View>
    <Text style={styles.dashboardActionText}>{label}</Text>
    <FontAwesomeIcon icon={faChevronRight} size={13} color="#8c8378" />
  </Pressable>
);

const ModalAction = ({ icon, label, onPress }) => (
  <Pressable onPress={onPress} style={styles.modalAction}>
    <FontAwesomeIcon icon={icon} size={16} color="#d8bd73" />
    <Text style={styles.modalActionText}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#050505",
  },
  scroll: {
    flex: 1,
  },
  content: {
    backgroundColor: "#050505",
  },
  hero: {
    backgroundColor: "#101010",
    borderBottomColor: "#292722",
    borderBottomWidth: 1,
    padding: 18,
  },
  profileRow: {
    alignItems: "center",
    flexDirection: "row",
  },
  avatarWrap: {
    flexShrink: 0,
  },
  avatar: {
    backgroundColor: "#242424",
    borderColor: "#d8bd73",
    borderWidth: 2,
  },
  cameraButton: {
    alignItems: "center",
    backgroundColor: "#d8bd73",
    borderRadius: 16,
    bottom: 0,
    height: 32,
    justifyContent: "center",
    position: "absolute",
    right: 0,
    width: 32,
  },
  profileCopy: {
    flex: 1,
    marginLeft: 16,
  },
  welcome: {
    color: "#d8bd73",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 7,
    textTransform: "uppercase",
  },
  userName: {
    color: "#fff8ef",
    fontSize: 27,
    fontWeight: "800",
  },
  compactUserName: {
    fontSize: 23,
  },
  userEmail: {
    color: "#b9b0a4",
    fontSize: 13,
    marginTop: 5,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  metric: {
    backgroundColor: "#171717",
    borderColor: "#2c2924",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 72,
    padding: 12,
  },
  metricValue: {
    color: "#fff8ef",
    fontSize: 22,
    fontWeight: "800",
  },
  metricLabel: {
    color: "#a9a096",
    fontSize: 12,
    marginTop: 3,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 18,
  },
  tabButton: {
    alignItems: "center",
    backgroundColor: "#121212",
    borderColor: "#292722",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 6,
    justifyContent: "center",
  },
  activeTabButton: {
    backgroundColor: "#d8bd73",
    borderColor: "#d8bd73",
  },
  tabText: {
    color: "#aaa196",
    fontSize: 12,
    fontWeight: "800",
  },
  activeTabText: {
    color: "#130f0b",
  },
  section: {
    paddingTop: 16,
  },
  coursePanel: {
    backgroundColor: "#131313",
    borderColor: "#2d2a25",
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  panelHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  panelEyebrow: {
    color: "#d8bd73",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  panelTitle: {
    color: "#fff8ef",
    fontSize: 22,
    fontWeight: "800",
    maxWidth: 260,
  },
  levelBadge: {
    alignItems: "center",
    backgroundColor: "#211c12",
    borderRadius: 8,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  levelBadgeText: {
    color: "#d8bd73",
    fontSize: 18,
    fontWeight: "800",
  },
  progressTrack: {
    backgroundColor: "#24211d",
    borderRadius: 999,
    height: 10,
    marginTop: 16,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: "#d8bd73",
    height: "100%",
  },
  progressText: {
    color: "#bdb4a9",
    fontSize: 13,
    marginTop: 10,
  },
  actionGrid: {
    gap: 10,
    marginTop: 12,
  },
  dashboardAction: {
    alignItems: "center",
    backgroundColor: "#121212",
    borderColor: "#292722",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 58,
    paddingHorizontal: 14,
  },
  actionIcon: {
    alignItems: "center",
    backgroundColor: "#211c12",
    borderRadius: 8,
    height: 34,
    justifyContent: "center",
    marginRight: 12,
    width: 34,
  },
  dashboardActionText: {
    color: "#f4efe7",
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  certificatePanel: {
    alignItems: "center",
    backgroundColor: "#131313",
    borderColor: "#2d2a25",
    borderRadius: 8,
    borderWidth: 1,
    padding: 18,
  },
  certificateIcon: {
    alignItems: "center",
    backgroundColor: "#211c12",
    borderRadius: 8,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  certificateTitle: {
    color: "#fff8ef",
    fontSize: 24,
    fontWeight: "800",
    marginTop: 14,
    textAlign: "center",
  },
  certificateText: {
    color: "#bdb4a9",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
    textAlign: "center",
  },
  logoutButton: {
    alignItems: "center",
    alignSelf: "center",
    borderColor: "#4b1d1d",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    height: 44,
    justifyContent: "center",
    marginTop: 22,
    paddingHorizontal: 18,
  },
  logoutText: {
    color: "#e7ddd0",
    fontSize: 14,
    fontWeight: "800",
  },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    flex: 1,
    justifyContent: "center",
    padding: 22,
  },
  modalPanel: {
    backgroundColor: "#121212",
    borderColor: "rgba(216, 189, 115, 0.22)",
    borderRadius: 8,
    borderWidth: 1,
    padding: 18,
    width: "100%",
  },
  modalHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  modalTitle: {
    color: "#fff8ef",
    fontSize: 18,
    fontWeight: "800",
  },
  modalClose: {
    alignItems: "center",
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  modalAction: {
    alignItems: "center",
    borderTopColor: "#2d2a25",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 54,
  },
  modalActionText: {
    color: "#f4efe7",
    fontSize: 15,
    fontWeight: "700",
  },
});

export default HomeScreen;
