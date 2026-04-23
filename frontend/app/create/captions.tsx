import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Button from "../../components/Button";
import { StepHeader } from "../../components/StepHeader";
import { theme } from "../../lib/theme";
import { api } from "../../lib/api";
import { useWizard, GeneratedCaption } from "../../lib/WizardContext";

const STYLE_TITLE: Record<string, string> = {
  short_catchy: "Short & catchy",
  friendly_local: "Friendly local",
  promotional_cta: "Promotional",
};
const STYLE_SUB: Record<string, string> = {
  short_catchy: "Punchy, scroll-stopping",
  friendly_local: "Warm and neighbourly",
  promotional_cta: "Gentle call to action",
};

export default function CaptionsStep() {
  const router = useRouter();
  const { selectedImage, prompt, tone, postGoal, generatedCaptions, selectedCaption, set } = useWizard();
  const [loading, setLoading] = useState(generatedCaptions.length === 0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedImage) {
      router.replace("/create/images");
      return;
    }
    if (generatedCaptions.length > 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res: any = await api.generateCaptions({
          generated_image_id: selectedImage.id,
          prompt, tone, post_goal: postGoal,
        });
        if (!cancelled) set("generatedCaptions", res.captions as GeneratedCaption[]);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "We couldn't write captions right now. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = async () => {
    set("generatedCaptions", []);
    set("selectedCaption", null);
    setLoading(true);
    setErr(null);
    try {
      const res: any = await api.generateCaptions({
        generated_image_id: selectedImage!.id,
        prompt, tone, post_goal: postGoal,
      });
      set("generatedCaptions", res.captions);
    } catch (e: any) {
      setErr(e?.message || "Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const onNext = () => {
    if (!selectedCaption) return;
    router.push("/create/review");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={22} color={theme.colors.text800} />
        </TouchableOpacity>
        <StepHeader step={4} total={5} title="Choose a caption" subtitle="Three options, written for your post." />

        {loading ? (
          <View style={styles.loaderBox} testID="captions-loading">
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.loaderTitle}>Writing your captions…</Text>
          </View>
        ) : err ? (
          <View style={styles.errorBox} testID="captions-error">
            <Ionicons name="alert-circle-outline" size={32} color={theme.colors.danger} />
            <Text style={styles.errorTitle}>Couldn't write captions</Text>
            <Text style={styles.errorSub}>{err}</Text>
            <Button label="Try again" onPress={retry} testID="captions-retry" />
          </View>
        ) : (
          <>
            {generatedCaptions.map((c, i) => {
              const isSel = selectedCaption?.id === c.id;
              return (
                <TouchableOpacity
                  key={c.id}
                  activeOpacity={0.9}
                  onPress={() => set("selectedCaption", c)}
                  style={[styles.capCard, isSel && styles.capSelected]}
                  testID={`caption-option-${i}`}
                >
                  <View style={styles.capHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.capStyle}>{STYLE_TITLE[c.style] || c.style}</Text>
                      <Text style={styles.capStyleSub}>{STYLE_SUB[c.style] || ""}</Text>
                    </View>
                    <View style={[styles.radio, isSel && styles.radioSelected]}>
                      {isSel ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                    </View>
                  </View>
                  <Text style={styles.capText}>{c.caption}</Text>
                  {c.cta ? <Text style={styles.capCta}>{c.cta}</Text> : null}
                  {c.hashtags?.length ? (
                    <Text style={styles.capTags}>{c.hashtags.join(" ")}</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}

            <View style={{ height: 20 }} />
            <Button
              label={selectedCaption ? "Use this caption" : "Select a caption above"}
              onPress={onNext}
              disabled={!selectedCaption}
              testID="captions-continue"
            />
            <View style={{ height: 10 }} />
            <Button label="Regenerate" variant="secondary" onPress={retry} testID="captions-regen" />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { padding: 20, paddingBottom: 40 },
  back: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center", marginBottom: 10, ...theme.shadow.card,
  },
  loaderBox: {
    backgroundColor: "#fff", borderRadius: 24, padding: 30, alignItems: "center", marginTop: 20,
    ...theme.shadow.card,
  },
  loaderTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.text900, marginTop: 12 },
  errorBox: {
    backgroundColor: "#fff", borderRadius: 24, padding: 24, alignItems: "center", marginTop: 20, gap: 10,
    ...theme.shadow.card,
  },
  errorTitle: { fontSize: 17, fontWeight: "800", color: theme.colors.text900 },
  errorSub: { fontSize: 13, color: theme.colors.text600, textAlign: "center", marginBottom: 8 },
  capCard: {
    backgroundColor: "#fff", borderRadius: 22, padding: 16, marginBottom: 12,
    borderWidth: 3, borderColor: "transparent", ...theme.shadow.card,
  },
  capSelected: { borderColor: theme.colors.primary },
  capHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  capStyle: { fontSize: 15, fontWeight: "800", color: theme.colors.text900 },
  capStyleSub: { fontSize: 12, color: theme.colors.text600, marginTop: 2 },
  capText: { fontSize: 15, color: theme.colors.text800, lineHeight: 22 },
  capCta: { fontSize: 14, color: theme.colors.primary, fontWeight: "700", marginTop: 10 },
  capTags: { fontSize: 13, color: theme.colors.secondary, marginTop: 10, fontWeight: "600" },
  radio: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: theme.colors.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  radioSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
});
