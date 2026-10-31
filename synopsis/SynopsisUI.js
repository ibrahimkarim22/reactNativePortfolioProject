import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { useFonts } from 'expo-font';
import { CourseText } from '../course/CourseUI';

const fonts = { BardSynopsisSerif: require('../assets/reader-fonts/source-serif-4/SourceSerif4-Regular.ttf') };
const fallback = Platform.OS === 'android' ? 'serif' : 'Georgia';

export function SynopsisProse({ children, style, ...props }) {
  const [ready] = useFonts(fonts);
  return <CourseText {...props} style={[styles.prose, { fontFamily: ready ? 'BardSynopsisSerif' : fallback }, style]}>
    {children}
  </CourseText>;
}

const styles = StyleSheet.create({
  prose: { fontSize: 18, lineHeight: 30, fontWeight: '400' },
});
