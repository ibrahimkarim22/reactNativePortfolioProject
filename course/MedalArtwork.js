import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { getMedalAppearance } from "./medalAppearance";

// Source-pixel measurements of the original artwork's fastening holes. The three
// exceptions have different positions or proportions, even when canvas sizes match.
const commonMount = { width: 411, height: 503, x: 204.5, y: 111.5, holeWidth: 40, holeHeight: 40 };
const mounts = new Map([
  require("../assets/medalCollection/m1H4.png"),
  require("../assets/medalCollection/m1H6.png"),
  require("../assets/medalCollection/m2H4.png"),
  require("../assets/medalCollection/m2H6.png"),
  require("../assets/medalCollection/m3H6.png"),
  require("../assets/medalCollection/mAdo.png"),
  require("../assets/medalCollection/mANT.png"),
  require("../assets/medalCollection/mAYL.png"),
  require("../assets/medalCollection/mCor.png"),
  require("../assets/medalCollection/mCym.png"),
  require("../assets/medalCollection/mErr.png"),
  require("../assets/medalCollection/mH5.png"),
  require("../assets/medalCollection/mH8.png"),
  require("../assets/medalCollection/mHam.png"),
  require("../assets/medalCollection/mJC.png"),
  require("../assets/medalCollection/mJn.png"),
  require("../assets/medalCollection/mLLL.png"),
  require("../assets/medalCollection/mLr.png"),
  require("../assets/medalCollection/mMac.png"),
  require("../assets/medalCollection/mMM.png"),
  require("../assets/medalCollection/mMV.png"),
  require("../assets/medalCollection/mOth.png"),
  require("../assets/medalCollection/mPer.png"),
  require("../assets/medalCollection/mR2.png"),
  require("../assets/medalCollection/mR3.png"),
  require("../assets/medalCollection/mShr.png"),
  require("../assets/medalCollection/mTGV.png"),
  require("../assets/medalCollection/mTim.png"),
  require("../assets/medalCollection/mTit.png"),
  require("../assets/medalCollection/mTmp.png"),
  require("../assets/medalCollection/mTN.png"),
  require("../assets/medalCollection/mTNK.png"),
  require("../assets/medalCollection/mTro.png"),
  require("../assets/medalCollection/mWiv.png"),
  require("../assets/medalCollection/mWT.png"),
].map(source => [source, commonMount]));
mounts.set(require("../assets/medalCollection/mAWW.png"), { ...commonMount, y: 102.5, holeWidth: 44 });
mounts.set(require("../assets/medalCollection/mMND.png"), { width: 400, height: 400, x: 200, y: 83, holeWidth: 39, holeHeight: 39 });
mounts.set(require("../assets/medalCollection/mRom.png"), { width: 400, height: 400, x: 200, y: 81, holeWidth: 39, holeHeight: 39 });

function MedalMount({ geometry, diameter, strap }) {
  const scale = Math.min(diameter / geometry.width, diameter / geometry.height);
  const x = (diameter - geometry.width * scale) / 2 + geometry.x * scale;
  const y = (diameter - geometry.height * scale) / 2 + geometry.y * scale;
  const holeWidth = geometry.holeWidth * scale;
  const holeHeight = geometry.holeHeight * scale;
  const strapWidth = holeWidth * 0.9;
  const strapHeight = holeHeight * 0.95;
  return <View testID="medal-mount" pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={styles.mount}>
    <View testID="medal-connector" style={[styles.connector, { left: x - holeWidth * 0.21,
      top: y - holeHeight * 1.12, width: holeWidth * 0.42, height: holeHeight * 0.6,
      borderRadius: holeHeight * 0.06 }]} />
    <View testID="medal-strap" style={[styles.strap, { left: x - strapWidth / 2,
      top: y - holeHeight * 1.03 - strapHeight, width: strapWidth, height: strapHeight,
      borderRadius: Math.min(2, holeHeight * 0.08), backgroundColor: strap.fill, borderColor: strap.edge }]}>
      <View testID="medal-strap-fold" style={[styles.fold, { bottom: holeHeight * 0.1,
        height: Math.max(1, holeHeight * 0.1), backgroundColor: strap.fold }]} />
    </View>
    <View testID="medal-cap" style={[styles.cap, { left: x - holeWidth * 0.675,
      top: y - holeHeight * 0.78, width: holeWidth * 1.35, height: holeHeight * 1.39,
      borderTopLeftRadius: holeHeight * 0.15, borderTopRightRadius: holeHeight * 0.15,
      borderBottomLeftRadius: holeHeight * 0.24, borderBottomRightRadius: holeHeight * 0.24 }]} />
  </View>;
}

export default function MedalArtwork({ play, size = 228, onReady }) {
  const source = play?.medalImage;
  const appearance = getMedalAppearance(play?.genre);
  const request = useMemo(() => {
    let available = false;
    let asset;
    if (source && typeof Image.resolveAssetSource === "function") {
      try {
        asset = Image.resolveAssetSource(source);
        available = typeof asset?.uri === "string" && asset.uri.length > 0;
      } catch (_) { /* A missing mapping uses the same terminal fallback as a failed load. */ }
    }
    return { available, asset, terminal: !available, notified: false };
  }, [source]);
  const activeRequest = useRef(request);
  activeRequest.current = request;
  const [loadState, setLoadState] = useState(null);
  const status = !request.available ? "failed" : loadState?.request === request ? loadState.status : "pending";
  useEffect(() => {
    activeRequest.current = request;
    return () => {
      if (activeRequest.current === request) activeRequest.current = null;
    };
  }, [request]);
  useEffect(() => {
    if (status !== "pending" && activeRequest.current === request && !request.notified && typeof onReady === "function") {
      request.notified = true;
      onReady();
    }
  }, [request, status, onReady]);
  const settle = nextStatus => {
    if (activeRequest.current !== request || request.terminal) return;
    request.terminal = true;
    setLoadState({ request, status: nextStatus });
  };
  const label = `${play?.name || "Play"} medal`;
  const diameter = Number.isFinite(size) && size >= 64 ? size : 228;
  const footprint = { width: diameter, height: diameter };
  if (status === "failed") return <View style={[styles.unavailable, footprint]}>
    <Text allowFontScaling accessibilityLabel={`${label} artwork unavailable`} accessibilityLiveRegion="polite"
      style={styles.unavailableText}>Medal artwork unavailable</Text>
  </View>;
  const pending = status === "pending";
  const geometry = mounts.get(source);
  const mounted = geometry && request.asset?.width === geometry.width && request.asset?.height === geometry.height;
  return <View accessibilityElementsHidden={pending} importantForAccessibility={pending ? "no-hide-descendants" : "auto"}
    style={[styles.frame, footprint, { opacity: pending ? 0 : 1 }]}>
    <Image key={source} source={source} resizeMode="contain" fadeDuration={0} accessibilityLabel={label} accessible
      onLoad={() => settle("loaded")} onError={() => settle("failed")} style={styles.artwork} />
    {mounted && <MedalMount geometry={geometry} diameter={diameter} strap={appearance.strap} />}
  </View>;
}

const styles = StyleSheet.create({
  frame: { alignSelf: "center", position: "relative" },
  artwork: { width: "100%", height: "100%", aspectRatio: 1 },
  mount: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  connector: { position: "absolute", backgroundColor: "#bca16b", borderColor: "#d1bb87", borderWidth: 0.6 },
  cap: { position: "absolute", backgroundColor: "#b59b65", borderWidth: 0.8, borderColor: "#bfa36c",
    borderTopColor: "#decba2", borderBottomColor: "#806a43" },
  strap: { position: "absolute", borderWidth: 0.6 },
  fold: { position: "absolute", left: 1, right: 1 },
  unavailable: { alignSelf: "center", alignItems: "center", justifyContent: "center", padding: 12 },
  unavailableText: { color: "#b5ac9d", fontSize: 15, lineHeight: 23, textAlign: "center" },
});
