import { View, Text, StyleSheet, StatusBar } from 'react-native'; 

export const Welcome = () => {
    return (
        <View style={styles.container}>
          <Text style={{ color: 'white' }}>Shakespeare Certificate</Text>
          <StatusBar style="auto" />
        </View>
      );
    }
    
    const styles = StyleSheet.create({
      container: {
        flex: 1,
        backgroundColor: 'black',
        alignItems: 'center',
        justifyContent: 'center',
      },
    });
