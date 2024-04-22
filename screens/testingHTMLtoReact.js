import React from 'react';
import { WebView } from 'react-native-webview';

const HTMLScreen = () => {
  return (
    <WebView
      originWhitelist={['*']}
      source={{ uri: '../HTML/2HenryVI.html' }} // Update the URI based on your file location
      style={{ flex: 1 }}
    />
  );
};

export default HTMLScreen;
