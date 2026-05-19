import {
  ImageBackground,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import {
  faArrowRight,
  faAward,
  faBookOpen,
  faCertificate,
  faCrown,
  faRightToBracket,
  faUserPlus,
} from "@fortawesome/free-solid-svg-icons";
import FolgerMidsummer from "../assets/images/FolgerMidsummer.jpg";
import { PLAYS } from "../shared/localPlayService";

const features = [
  {
    icon: faBookOpen,
    value: `${PLAYS.length}`,
    label: "complete plays",
  },
  {
    icon: faCrown,
    value: `${PLAYS.length}`,
    label: "guided quizzes",
  },
  {
    icon: faAward,
    value: `${PLAYS.length}`,
    label: "earned medals",
  },
  {
    icon: faCertificate,
    value: "1",
    label: "final certificate",
  },
];

const ActionButton = ({ icon, label, onPress, variant = "primary" }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      styles.actionButton,
      variant === "secondary" && styles.secondaryButton,
      pressed && styles.actionButtonPressed,
    ]}
  >
    <View style={styles.actionLeft}>
      <FontAwesomeIcon
        icon={icon}
        size={17}
        color={variant === "secondary" ? "#f4efe7" : "#130f0b"}
      />
      <Text
        style={[
          styles.actionText,
          variant === "secondary" && styles.secondaryActionText,
        ]}
      >
        {label}
      </Text>
    </View>
    <FontAwesomeIcon
      icon={faArrowRight}
      size={15}
      color={variant === "secondary" ? "#c9b06a" : "#130f0b"}
    />
  </Pressable>
);

export const RootScreen = ({ navigation }) => {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ImageBackground source={FolgerMidsummer} style={styles.hero}>
          <View style={styles.heroShade} />
          <View style={styles.topBar}>
            <View>
              <Text style={styles.brand}>BARD</Text>
              <Text style={styles.brandMeta}>Shakespeare, rebuilt for mobile</Text>
            </View>
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.kicker}>The complete Shakespeare companion</Text>
            <Text style={styles.headline}>
              Read, learn, and master every play.
            </Text>
            <Text style={styles.subhead}>
              A focused course experience with local texts, progress, medals,
              and a certificate path.
            </Text>
          </View>
        </ImageBackground>

        <View style={styles.body}>
          <View style={styles.statsGrid}>
            {features.map((feature) => (
              <View key={feature.label} style={styles.statItem}>
                <View style={styles.statIcon}>
                  <FontAwesomeIcon icon={feature.icon} size={15} color="#d8bd73" />
                </View>
                <Text style={styles.statValue}>{feature.value}</Text>
                <Text style={styles.statLabel}>{feature.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.ctaGroup}>
            <ActionButton
              icon={faUserPlus}
              label="Create account"
              onPress={() => navigation.navigate("SignUp")}
            />
            <ActionButton
              icon={faRightToBracket}
              label="Log in"
              variant="secondary"
              onPress={() => navigation.navigate("Login")}
            />
          </View>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#050505",
  },
  container: {
    flex: 1,
    backgroundColor: "#050505",
  },
  content: {
    flexGrow: 1,
    backgroundColor: "#050505",
  },
  hero: {
    minHeight: 470,
    justifyContent: "space-between",
    overflow: "hidden",
  },
  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3, 4, 4, 0.58)",
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingTop: 18,
  },
  brand: {
    color: "#f7f0e5",
    fontSize: 18,
    fontWeight: "800",
  },
  brandMeta: {
    color: "#d8d0c4",
    fontSize: 12,
    marginTop: 3,
  },
  heroCopy: {
    paddingBottom: 38,
    paddingHorizontal: 22,
  },
  kicker: {
    color: "#d8bd73",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 12,
    textTransform: "uppercase",
  },
  headline: {
    color: "#fff8ef",
    fontSize: 44,
    fontWeight: "800",
    lineHeight: 48,
    maxWidth: 350,
  },
  subhead: {
    color: "#e4ddd1",
    fontSize: 16,
    lineHeight: 23,
    marginTop: 16,
    maxWidth: 340,
  },
  body: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statItem: {
    backgroundColor: "#131313",
    borderColor: "#292826",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 104,
    padding: 13,
    width: "48.5%",
  },
  statIcon: {
    alignItems: "center",
    backgroundColor: "#211c12",
    borderRadius: 8,
    height: 30,
    justifyContent: "center",
    marginBottom: 12,
    width: 30,
  },
  statValue: {
    color: "#fff8ef",
    fontSize: 25,
    fontWeight: "800",
  },
  statLabel: {
    color: "#bcb4a8",
    fontSize: 13,
    marginTop: 3,
  },
  ctaGroup: {
    gap: 12,
    marginTop: 18,
  },
  actionButton: {
    alignItems: "center",
    backgroundColor: "#d8bd73",
    borderRadius: 8,
    flexDirection: "row",
    height: 56,
    justifyContent: "space-between",
    paddingHorizontal: 18,
  },
  secondaryButton: {
    backgroundColor: "#141414",
    borderColor: "#34302a",
    borderWidth: 1,
  },
  actionButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  actionLeft: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  actionText: {
    color: "#130f0b",
    fontSize: 16,
    fontWeight: "800",
  },
  secondaryActionText: {
    color: "#f4efe7",
  },
});
