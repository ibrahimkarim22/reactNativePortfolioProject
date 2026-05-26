import {
  ImageBackground,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import {
  faCheck,
  faChevronRight,
  faCrown,
  faFilter,
  faLock,
  faPlay,
} from "@fortawesome/free-solid-svg-icons";
import { useNavigation } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { PLAYS } from "../shared/localPlayService";

const genres = ["All", "Comedy", "Tragedy", "History", "Romance"];

const genreTone = {
  Comedy: {
    backgroundColor: "#173a2b",
    borderColor: "#2d7a58",
    color: "#9be1bd",
  },
  Tragedy: {
    backgroundColor: "#3b1618",
    borderColor: "#7e2a31",
    color: "#f0a0a7",
  },
  History: {
    backgroundColor: "#172d3f",
    borderColor: "#315f84",
    color: "#a8d3f3",
  },
  Romance: {
    backgroundColor: "#3b2438",
    borderColor: "#7c4c74",
    color: "#efb8df",
  },
};

const getGenreTone = (genre) =>
  genreTone[genre] || {
    backgroundColor: "#211c12",
    borderColor: "#3b321f",
    color: "#d8bd73",
  };

const getPlayStatus = (difficulty, completedCount) => {
  if (difficulty <= completedCount) return "completed";
  if (difficulty === completedCount + 1) return "active";
  return "locked";
};

const getStatusCopy = (status, play) => {
  if (status === "completed") return "Completed";
  if (status === "active") return play.difficulty === 1 ? "Start" : "Continue";
  return `Unlocks after ${play.difficulty - 1}`;
};

const CourseScreen = () => {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const [selectedGenre, setSelectedGenre] = useState("All");

  const completed = useSelector((state) => state.course.completedLevel);
  const plays = useMemo(
    () => PLAYS.slice().sort((a, b) => a.difficulty - b.difficulty),
    []
  );

  const totalPlays = plays.length;
  const completedCount = Math.max(
    0,
    Math.min(totalPlays, Number(completed) || 0)
  );
  const nextUnlockedLevel = Math.min(totalPlays, completedCount + 1);
  const progress = totalPlays ? completedCount / totalPlays : 0;
  const activePlay =
    plays.find((play) => play.difficulty === nextUnlockedLevel) ||
    plays[plays.length - 1];
  const visiblePlays = plays.filter(
    (play) => selectedGenre === "All" || play.genre === selectedGenre
  );
  const isCompact = width < 360;

  const handlePlayPress = (play) => {
    if (play.difficulty > completedCount + 1) return;
    navigation.navigate("Lesson", { id: play.id });
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <ImageBackground
            source={activePlay?.mainImage}
            style={styles.heroImage}
            imageStyle={styles.heroImageStyle}
          >
            <View style={styles.heroShade} />
            <View style={styles.heroContent}>
              <View style={styles.heroKickerRow}>
                <FontAwesomeIcon icon={faCrown} size={14} color="#d8bd73" />
                <Text style={styles.kicker}>
                  {progress >= 1 ? "Course complete" : "Next unlocked play"}
                </Text>
              </View>
              <Text
                style={[styles.heroTitle, isCompact && styles.compactHeroTitle]}
                numberOfLines={2}
              >
                {progress >= 1
                  ? "The full path is complete"
                  : activePlay?.name || "Shakespeare Course"}
              </Text>
              <Text style={styles.heroSubtitle}>
                {completedCount} of {totalPlays} plays completed
              </Text>
            </View>
          </ImageBackground>

          <View style={styles.progressPanel}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>Course progress</Text>
              <Text style={styles.progressValue}>
                {Math.round(progress * 100)}%
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${progress * 100}%` }]}
              />
            </View>
            <View style={styles.statRow}>
              <Metric value={completedCount} label="completed" />
              <Metric value={nextUnlockedLevel} label="next" />
              <Metric value={totalPlays - completedCount} label="remaining" />
            </View>
          </View>
        </View>

        <View style={styles.filterHeader}>
          <View style={styles.filterTitleRow}>
            <FontAwesomeIcon icon={faFilter} size={13} color="#d8bd73" />
            <Text style={styles.sectionTitle}>Course Path</Text>
          </View>
          <Text style={styles.sectionMeta}>{visiblePlays.length} plays</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.genreScroller}
        >
          {genres.map((genre) => {
            const selected = selectedGenre === genre;
            return (
              <Pressable
                key={genre}
                onPress={() => setSelectedGenre(genre)}
                style={[styles.genreChip, selected && styles.genreChipActive]}
              >
                <Text
                  style={[
                    styles.genreChipText,
                    selected && styles.genreChipTextActive,
                  ]}
                >
                  {genre}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.playList}>
          {visiblePlays.map((play) => {
            const status = getPlayStatus(play.difficulty, completedCount);
            return (
              <CourseCard
                key={play.id}
                play={play}
                status={status}
                isCompact={isCompact}
                onPress={() => handlePlayPress(play)}
              />
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
};

const Metric = ({ value, label }) => (
  <View style={styles.metric}>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>
);

const CourseCard = ({ play, status, isCompact, onPress }) => {
  const tone = getGenreTone(play.genre);
  const locked = status === "locked";
  const completed = status === "completed";
  const active = status === "active";
  const statusIcon = completed ? faCheck : active ? faPlay : faLock;

  return (
    <Pressable
      disabled={locked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.courseCard,
        active && styles.courseCardActive,
        locked && styles.courseCardLocked,
        pressed && styles.pressed,
      ]}
    >
      <ImageBackground
        source={play.mainImage}
        style={[styles.cardArt, isCompact && styles.compactCardArt]}
        imageStyle={styles.cardArtImage}
      >
        <View style={[styles.cardArtShade, locked && styles.lockedArtShade]} />
      </ImageBackground>

      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <View style={styles.levelPill}>
            <Text style={styles.levelPillText}>{play.difficulty}</Text>
          </View>
          <View
            style={[
              styles.genrePill,
              {
                backgroundColor: tone.backgroundColor,
                borderColor: tone.borderColor,
              },
            ]}
          >
            <Text style={[styles.genreText, { color: tone.color }]}>
              {play.genre || "Play"}
            </Text>
          </View>
        </View>

        <Text
          style={[
            styles.playTitle,
            locked && styles.lockedText,
            isCompact && styles.compactPlayTitle,
          ]}
          numberOfLines={2}
        >
          {play.name}
        </Text>

        <View style={styles.cardFooter}>
          <View
            style={[
              styles.statusPill,
              completed && styles.statusPillDone,
              active && styles.statusPillActive,
            ]}
          >
            <FontAwesomeIcon
              icon={statusIcon}
              size={11}
              color={locked ? "#726a5d" : active ? "#130f0b" : "#d8bd73"}
            />
            <Text
              style={[
                styles.statusText,
                locked && styles.lockedText,
                active && styles.statusTextActive,
              ]}
              numberOfLines={1}
            >
              {getStatusCopy(status, play)}
            </Text>
          </View>
          {!locked && (
            <FontAwesomeIcon
              icon={faChevronRight}
              size={13}
              color={active ? "#d8bd73" : "#8d8373"}
            />
          )}
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#050505",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 30,
  },
  hero: {
    backgroundColor: "#0d0d0c",
    borderBottomColor: "#242016",
    borderBottomWidth: 1,
  },
  heroImage: {
    height: 210,
    justifyContent: "flex-end",
  },
  heroImageStyle: {
    resizeMode: "cover",
  },
  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 5, 5, 0.58)",
  },
  heroContent: {
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  heroKickerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 9,
  },
  kicker: {
    color: "#d8bd73",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  heroTitle: {
    color: "#fff8ef",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 38,
  },
  compactHeroTitle: {
    fontSize: 29,
    lineHeight: 33,
  },
  heroSubtitle: {
    color: "#d8d0c2",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 8,
  },
  progressPanel: {
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  progressHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressLabel: {
    color: "#a9a190",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  progressValue: {
    color: "#f4df9a",
    fontSize: 15,
    fontWeight: "900",
  },
  progressTrack: {
    backgroundColor: "#24211d",
    borderRadius: 999,
    height: 9,
    marginTop: 11,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: "#d8bd73",
    height: "100%",
  },
  statRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: 13,
  },
  metric: {
    backgroundColor: "#151514",
    borderColor: "#2c2924",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  metricValue: {
    color: "#fff8ef",
    fontSize: 19,
    fontWeight: "900",
  },
  metricLabel: {
    color: "#9e9485",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  filterHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  filterTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  sectionTitle: {
    color: "#fff8ef",
    fontSize: 18,
    fontWeight: "900",
  },
  sectionMeta: {
    color: "#8f8679",
    fontSize: 12,
    fontWeight: "800",
  },
  genreScroller: {
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 13,
  },
  genreChip: {
    alignItems: "center",
    backgroundColor: "#121211",
    borderColor: "#292722",
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    paddingHorizontal: 15,
  },
  genreChipActive: {
    backgroundColor: "#d8bd73",
    borderColor: "#d8bd73",
  },
  genreChipText: {
    color: "#aaa196",
    fontSize: 12,
    fontWeight: "900",
  },
  genreChipTextActive: {
    color: "#130f0b",
  },
  playList: {
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  courseCard: {
    backgroundColor: "#10100f",
    borderColor: "#292722",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 124,
    overflow: "hidden",
  },
  courseCardActive: {
    borderColor: "#d8bd73",
    backgroundColor: "#14120d",
  },
  courseCardLocked: {
    opacity: 0.72,
  },
  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
  cardArt: {
    width: 106,
  },
  compactCardArt: {
    width: 88,
  },
  cardArtImage: {
    resizeMode: "cover",
  },
  cardArtShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 5, 5, 0.14)",
  },
  lockedArtShade: {
    backgroundColor: "rgba(5, 5, 5, 0.68)",
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
    padding: 13,
  },
  cardTopRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  levelPill: {
    alignItems: "center",
    backgroundColor: "#211c12",
    borderRadius: 8,
    height: 26,
    justifyContent: "center",
    minWidth: 30,
    paddingHorizontal: 8,
  },
  levelPillText: {
    color: "#d8bd73",
    fontSize: 12,
    fontWeight: "900",
  },
  genrePill: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  genreText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  playTitle: {
    color: "#fff8ef",
    flex: 1,
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 21,
    marginTop: 9,
  },
  compactPlayTitle: {
    fontSize: 15,
    lineHeight: 19,
  },
  lockedText: {
    color: "#726a5d",
  },
  cardFooter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  statusPill: {
    alignItems: "center",
    backgroundColor: "#171615",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    minHeight: 30,
    maxWidth: "88%",
    paddingHorizontal: 9,
  },
  statusPillDone: {
    backgroundColor: "#1d2117",
  },
  statusPillActive: {
    backgroundColor: "#d8bd73",
  },
  statusText: {
    color: "#d8bd73",
    fontSize: 11,
    fontWeight: "900",
  },
  statusTextActive: {
    color: "#130f0b",
  },
});

export default CourseScreen;
