import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fetchFolger } from '../folgerLibrary/folgerSlice';
import { getLocalPlayEntry } from '../shared/localPlayService';
import { CourseButton, CourseHeading, CoursePage, CourseText, COURSE_COLORS } from '../course/CourseUI';
import { SynopsisProse } from '../synopsis/SynopsisUI';

const sections = [{ id: 'overview', label: 'Overview' }, { id: 'story', label: 'Full story' }, { id: 'acts', label: 'By act' }];
const initialView = () => ({ section: 'overview', expanded: {} });

function SynopsisBody({ synopsis, entry, navigation, view, updateView, offsets, identity }) {
  const metadata = [entry.play.author, entry.play.genre || entry.genre, entry.play.acts.length + ' acts'].filter(Boolean).join(' · ');
  const readPlay = <CourseButton title="Read full play" variant="quiet"
    onPress={() => navigation.navigate('MIT', { id: synopsis.workId })} />;
  return <SafeAreaView style={styles.page} edges={['left', 'right', 'bottom']}>
    <StatusBar barStyle="light-content" backgroundColor={COURSE_COLORS.background} />
    <View accessibilityRole="tablist" accessibilityLabel="Synopsis sections" style={styles.sections}>
      {sections.map(section => <Pressable key={section.id} accessibilityRole="tab" accessibilityLabel={section.label}
        accessibilityState={{ selected: view.section === section.id }}
        onPress={() => updateView(previous => ({ ...previous, section: section.id }))}
        style={[styles.sectionButton, view.section === section.id && styles.selectedSection]}>
        <CourseText style={[styles.sectionLabel, view.section === section.id && styles.selectedLabel]}>{section.label}</CourseText>
      </Pressable>)}
    </View>
    <ScrollView key={identity + ':' + view.section} style={styles.scroll} contentContainerStyle={styles.content}
      contentOffset={{ x: 0, y: offsets[view.section] || 0 }} scrollEventThrottle={32}
      onScroll={event => {
        const y = event.nativeEvent.contentOffset.y;
        if (Number.isFinite(y) && y >= 0) offsets[view.section] = y;
      }}>
      <CourseHeading title={synopsis.title} subtitle={metadata} />
      {view.section === 'overview' ? <>
        <SynopsisProse>{synopsis.introduction}</SynopsisProse>
        {readPlay}
      </> : <>
        {readPlay}
        {view.section === 'story' ? <>
          <CourseText tone="muted" style={styles.spoilers}>Contains the ending</CourseText>
          {synopsis.fullSynopsis.map(paragraph => <SynopsisProse key={paragraph.id}>{paragraph.text}</SynopsisProse>)}
        </> : <View style={styles.acts}>
          {synopsis.summarySections.map(section => <View key={section.id} style={styles.act}>
            <Pressable accessibilityRole="button" accessibilityLabel={section.label}
              accessibilityHint={view.expanded[section.id] ? 'Hide this summary.' : 'Show this summary.'}
              accessibilityState={{ expanded: !!view.expanded[section.id] }} style={styles.actButton}
              onPress={() => updateView(previous => ({ ...previous, expanded: {
                ...previous.expanded, [section.id]: !previous.expanded[section.id],
              } }))}>
              <CourseText style={styles.actLabel}>{section.label}</CourseText>
              <CourseText accessible={false} style={styles.indicator}>{view.expanded[section.id] ? '\u2212' : '+'}</CourseText>
            </Pressable>
            {!!view.expanded[section.id] && <SynopsisProse style={styles.actSummary}>{section.summary}</SynopsisProse>}
          </View>)}
        </View>}
      </>}
    </ScrollView>
  </SafeAreaView>;
}

export default function Synopsis() {
  const navigation = useNavigation();
  const id = useRoute()?.params?.id;
  const dispatch = useDispatch();
  const state = useSelector(value => value.folger);
  const [views, setViews] = useState({});
  const positions = useRef({});
  const validId = (typeof id === 'string' && id.trim().length > 0) || Number.isSafeInteger(id);
  const entry = validId ? getLocalPlayEntry(id) : undefined;
  useEffect(() => { if (entry) dispatch(fetchFolger(id)); }, [dispatch, id, !!entry]);
  const current = state?.requestedId === String(id);
  const synopsis = current ? state.synopsis : null;
  const matches = synopsis && synopsis.workId === entry?.play.id
    && synopsis.contentVersion === entry.play.contentVersion
    && synopsis.canonicalTextVersion === entry.play.canonicalTextVersion;
  if (!entry || (current && state.errMess)) return <CoursePage>
    <CourseHeading title="Synopsis unavailable" />
    <CourseText>This play's synopsis could not be opened.</CourseText>
    <CourseButton title="Back to synopses" variant="secondary"
      onPress={() => navigation.navigate('Main', { screen: 'SynopsisList' })} />
  </CoursePage>;
  if (!current || state.isLoading || !matches) return <CoursePage>
    <ActivityIndicator color={COURSE_COLORS.gold} accessibilityLabel="Opening synopsis" />
    <CourseText tone="muted">Opening synopsis</CourseText>
  </CoursePage>;
  const identity = synopsis.workId + ':' + synopsis.synopsisContentVersion;
  if (!positions.current[identity]) positions.current[identity] = {};
  return <SynopsisBody key={identity} identity={identity} synopsis={synopsis} entry={entry} navigation={navigation}
    view={views[identity] || initialView()} offsets={positions.current[identity]}
    updateView={change => setViews(previous => ({ ...previous, [identity]: change(previous[identity] || initialView()) }))} />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COURSE_COLORS.background },
  sections: { width: '100%', maxWidth: 720, alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 4,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COURSE_COLORS.border },
  sectionButton: { flexGrow: 1, flexShrink: 0, minWidth: 96, minHeight: 48, paddingHorizontal: 8, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  selectedSection: { backgroundColor: '#29251c' },
  sectionLabel: { fontSize: 15, lineHeight: 23, color: COURSE_COLORS.muted, textAlign: 'center' },
  selectedLabel: { color: '#e1c98e', fontWeight: '600' },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 36, gap: 24 },
  spoilers: { fontSize: 14, lineHeight: 22 },
  acts: { gap: 4 },
  act: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COURSE_COLORS.border },
  actButton: { minHeight: 56, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  actLabel: { flex: 1, color: COURSE_COLORS.gold, fontWeight: '600' },
  indicator: { color: COURSE_COLORS.gold, fontSize: 24, lineHeight: 32 },
  actSummary: { paddingTop: 4, paddingBottom: 24 },
});
