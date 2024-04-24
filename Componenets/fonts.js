import {
    Khand_400Regular,
    Khand_700Bold,
  } from "@expo-google-fonts/khand";
  import { Sora_500Medium } from "@expo-google-fonts/sora";
  import { useFonts } from "@expo-google-fonts/khand";

  export const Fonts = () => {
    const [fontsLoaded] = useFonts({
      Khand_400Regular,
      Khand_700Bold,
      Sora_500Medium,
    });

    return fontsLoaded;
};
  