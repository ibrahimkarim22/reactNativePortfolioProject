import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import HTMLView from 'react-native-htmlview';
import { useDispatch, useSelector } from 'react-redux';
import { fetchMIT } from '../completeWorks/MITShakespeareSlice';
import { SafeAreaView } from 'react-native-safe-area-context';

const MITScreen = () => {
  const dispatch = useDispatch();
  const MITState = useSelector((state) => state.MIT);

  useEffect(() => {
    dispatch(fetchMIT());
  }, [dispatch]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.headerText}>MIT Shakespeare API Test</Text>
        {MITState.isLoading ? (
          <Text>Loading...</Text>
        ) : MITState.errMess ? (
          <Text>Error: {MITState.errMess}</Text>
        ) : (
          <HTMLView
            value={MITState.htmlContent}
            stylesheet={htmlStyles}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const htmlStyles = StyleSheet.create({
  a: {
    fontWeight: 'bold',
    color: 'blue',
  },
  b: {
    fontWeight: 'bold',
  },
  p: {
    color: 'red',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: 'white',
  },
  headerText: {
    fontSize: 24,
    marginBottom: 10,
  },
});

export default MITScreen;
