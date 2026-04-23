import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Image, Switch, TouchableOpacity, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Button from "../../components/Button";
import { StepHeader } from "../../components/StepHeader";
import { theme } from "../../lib/theme";
import { api } from "../../lib/api";
import { useWizard } from "../../lib/WizardContext";

export default function ReviewStep() {
  const router = useRouter();
  const {
    selectedImage, selectedCaption, instagramEnabled, facebookEnabled, set, reset,
  } = useWizard();
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<null | { ok: boolean; message: string; warnings: string[] }>(null);

  if (!selectedImage || !selectedCaption) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={{ padding: 20 }}>
          <Text style={{ color: theme.colors.text800 }}>Something is missing. Please start again.</Text>
          <View style={{ height: 12 }} />
          <Button label="Back to dashboard" onPress={() => { reset(); router.replace("/dashboard"); }} />
        </View>
      </SafeAreaView>
    );
  }

  const onPublish = async () => {
    if (!instagramEnabled && !facebookEnabled) {
      setResult({ ok: false, message: "Please turn on at least one platform.", warnings: [] });
      return;
    }
    setPublishing(true);
    setResult(null);
    try {
      const res: any = await api.createPost({
        generated_image_id: selectedImage.id,
        generated_caption_id: selectedCaption.id,
        instagram_enabled: instagramEnabled,
        facebook_enabled: facebookEnabled,
        schedule_for: null,
      });
      setResult({
        ok: true,
        message: "Your post was published successfully.",
        warnings: res.warnings || [],
      });
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || "Publish failed. Please try again.", warnings: [] });
    } finally {
      setPublishing(false);
    }
  };

  const goHome = () => {
    reset();
    router.replace("/dashboard");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={22} color={theme.colors.text800} />
        </TouchableOpacity>
        <StepHeader step={5} total={5} title="Review and publish" subtitle="One last check before it goes live." />

        <View style={styles.previewCard}>
          <Image source={{ uri: selectedImage.data_uri }} style={styles.previewImg} />
          <View style={styles.previewBody}>
            <Text style={styles.previewCaption}>{selectedCaption.caption}</Text>
            {selectedCaption.cta ? <Text style={styles.previewCta}>{selectedCaption.cta}</Text> : null}
            {selectedCaption.hashtags?.length ? (
              <Text style={styles.previewTags}>{selectedCaption.hashtags.join(" ")}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Where should we post it?</Text>
        <ToggleRow
          title="Instagram"
          subtitle="Primary destination"
          icon="logo-instagram"
          color="#E1306C"
          value={instagramEnabled}
          onChange={(v) => set("instagramEnabled", v)}
          testID="toggle-instagram"
        />
        <ToggleRow
          title="Facebook"
          subtitle="Optional"
          icon="logo-facebook"
          color="#1877F2"
          value={facebookEnabled}
          onChange={(v) => set("facebookEnabled", v)}
          testID="toggle-facebook"
        />

        <View style={styles.confirmBox}>
          <Ionicons name="checkmark-circle-outline" size={26} color={theme.colors.primary} />
          <Text style={styles.confirmTitle}>Ready to publish this post?</Text>
        </View>

        <Button label="Post now" onPress={onPublish} loading={publishing} testID="publish-btn" />
        <View style={{ height: 10 }} />
        <Button label="Go back and edit" variant="secondary" onPress={() => router.back()} testID="go-edit" />
      </ScrollView>

      <Modal visible={!!result} transparent animationType="fade" onRequestClose={goHome}>
        <View style={styles.resultWrap}>
          <View style={styles.resultCard} testID="publish-result">
            <View style={[styles.resultIcon, { backgroundColor: result?.ok ? theme.colors.primaryLight : "#FDEAE7" }]}>
              <Ionicons
                name={result?.ok ? "checkmark-circle" : "alert-circle"}
                size={44}
                color={result?.ok ? theme.colors.success : theme.colors.danger}
              />
            </View>
            <Text style={styles.resultTitle}>{result?.ok ? "Your post is live!" : "Couldn't publish"}</Text>
            <Text style={styles.resultMsg}>{result?.message}</Text>
            {result?.warnings?.length ? (
              <View style={styles.warnBox}>
                {result.warnings.map((w, i) => (
                  <Text key={i} style={styles.warnText}>• {w}</Text>
                ))}
              </View>
            ) : null}
            <View style={{ height: 14 }} />
            {result?.ok ? (
              <Button label="Back to dashboard" onPress={goHome} testID="result-home" />
            ) : (
              <>
                <Button label="Try again" onPress={() => setResult(null)} testID="result-retry" />
                <View style={{ height: 8 }} />
                <Button label="Back to dashboard" variant="secondary" onPress={goHome} />
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ToggleRow({ title, subtitle, icon, color, value, onChange, testID }: any) {
  return (
    <View style={styles.toggleRow}>
      <View style={[styles.toggleIcon, { backgroundColor: color + "22" }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleSub}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
        thumbColor={"#fff"}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { padding: 20, paddingBottom: 40 },
  back: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center", marginBottom: 10, ...theme.shadow.card,
  },
  previewCard: {
    backgroundColor: "#fff", borderRadius: 24, overflow: "hidden", ...theme.shadow.card, marginTop: 8,
  },
  previewImg: { width: "100%", height: 320, backgroundColor: theme.colors.border },
  previewBody: { padding: 16 },
  previewCaption: { fontSize: 15, color: theme.colors.text900, lineHeight: 22 },
  previewCta: { fontSize: 14, color: theme.colors.primary, fontWeight: "800", marginTop: 10 },
  previewTags: { fontSize: 13, color: theme.colors.secondary, marginTop: 8, fontWeight: "600" },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.text900, marginTop: 22, marginBottom: 10 },
  toggleRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 20,
    padding: 14, marginBottom: 10, ...theme.shadow.card,
  },
  toggleIcon: {
    width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  toggleTitle: { fontSize: 15, fontWeight: "800", color: theme.colors.text900 },
  toggleSub: { fontSize: 12, color: theme.colors.text600, marginTop: 2 },
  confirmBox: {
    marginTop: 20, marginBottom: 14, padding: 16, borderRadius: 20,
    backgroundColor: theme.colors.primaryLight, flexDirection: "row", alignItems: "center", gap: 10,
  },
  confirmTitle: { fontSize: 16, fontWeight: "800", color: theme.colors.text900, flex: 1 },
  resultWrap: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24,
  },
  resultCard: {
    backgroundColor: "#fff", borderRadius: 28, padding: 24, width: "100%", alignItems: "center",
    ...theme.shadow.card,
  },
  resultIcon: {
    width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  resultTitle: { fontSize: 22, fontWeight: "800", color: theme.colors.text900, marginBottom: 6 },
  resultMsg: { fontSize: 14, color: theme.colors.text600, textAlign: "center", marginBottom: 6 },
  warnBox: {
    backgroundColor: theme.colors.primaryLight, padding: 12, borderRadius: 12, marginTop: 10, width: "100%",
  },
  warnText: { fontSize: 12, color: theme.colors.text800, marginBottom: 4 },
});
