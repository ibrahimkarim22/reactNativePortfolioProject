import React from "react";
import { useRoute } from "@react-navigation/native";
import ReaderScreen from "../reader/ReaderScreen";

export default function MITFullPlayScreen({ highlightRuntime } = {}) {
  const route = useRoute();
  return <ReaderScreen id={route.params?.id} highlightRuntime={highlightRuntime} />;
}
