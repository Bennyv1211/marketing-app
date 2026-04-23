import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Button from "../../components/Button";
import { StepHeader } from "../../components/StepHeader";
import { theme } from "../../lib/theme";
import { api } from "../../lib/api";
import { useWizard, GeneratedImage } from "../../lib/WizardContext";

const STAGES = [
  "Uploading your image…",
  "Preparing creative options…",
  "Generating your ad images…",
  "Polishing the final result…",
];

export default function ImagesStep() {
  const router = useRouter();
  const { upload, prompt, tone, postGoal, generatedImages, selectedImage, set } = useWizard();
  const [loading, setLoading] = useState(generatedImages.length === 0);
  const [stageIdx, setStageIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!upload || !prompt) {
      router.replace("/create/upload");
      return;
    }
    if (generatedImages.length > 0) return;

    let cancelled = false;
    let stageTimer: any;

    (async () => {
      setLoading(true);
      setErr(null);
      setStageIdx(0);
      stageTimer = setInterval(() => {
        setStageIdx((i) => (i < STAGES.length - 1 ? i + 1 : i));
      }, 3500);
      try {
        const res: any = await api.generateImages({
          uploaded_image_id: upload.id,
          prompt,
          tone,
          post_goal: postGoal,
        });
        if (cancelled) return;
        set("generatedImages", res.images as GeneratedImage[]);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "We couldn't generate your ad images. Please try again.");
      } finally {
        clearInterval(stageTimer);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(stageTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = async () => {
    set("generatedImages", []);
    set("selectedImage", null);
    setLoading(true);
    setErr(null);
    try {
      const res: any = await api.generateImages({
        uploaded_image_id: upload!.id,
        prompt, tone, post_goal: postGoal,
      });
      set("generatedImages", res.images);
    } catch (e: any) {
      setErr(e?.message || "Couldn't generate. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const onChoose = (img: GeneratedImage) => {
    set("selectedImage", img);
  };

  const onNext = async () => {
    if (!selectedImage) return;
    try {
      // Commit the selection — backend will DELETE the other 2 un-chosen images.
      await api.selectGeneratedImage(selectedImage.id);
    } catch {
      // non-blocking: proceed either way
    }
    // Remove the other variations from local wizard state too
    set("generatedImages", [selectedImage]);
    set("generatedCaptions", []);
    set("selectedCaption", null);
    router.push("/create/captions");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={22} color={theme.colors.text800} />
        </TouchableOpacity>
        <StepHeader step={3} total={5} title="Pick your favourite" subtitle="We created 3 ad options — choose the one you like best." />

        {loading ? (
          <View style={styles.loaderBox} testID="images-loading">
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.loaderTitle}>Making your ads ✨</Text>
            <Text style={styles.loaderStage}>{STAGES[stageIdx]}</Text>
            <Text style={styles.loaderNote}>This usually takes 20–40 seconds.</Text>
          </View>
        ) : err ? (
          <View style={styles.errorBox} testID="images-error">
            <Ionicons name="alert-circle-outline" size={32} color={theme.colors.danger} />
            <Text style={styles.errorTitle}>Couldn't generate your ads</Text>
            <Text style={styles.errorSub}>{err}</Text>
            <Button label="Try again" onPress={retry} testID="images-retry" />
          </View>
        ) : (
          <>
            {generatedImages.map((img) => {
              const isSel = selectedImage?.id === img.id;
              return (
                <TouchableOpacity
                  key={img.id}
                  activeOpacity={0.9}
                  onPress={() => onChoose(img)}
                  style={[styles.imgCard, isSel && styles.imgCardSelected]}
                  testID={`image-option-${img.variation_index}`}
                >
                  <Image source={{ uri: img.data_uri }} style={styles.img} />
                  <View style={styles.imgFooter}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.imgStyle}>{img.style_name}</Text>
                      <Text style={styles.imgHint}>Option {img.variation_index + 1}</Text>
                    </View>
                    <View style={[styles.radio, isSel && styles.radioSelected]}>
                      {isSel ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}

            <View style={{ height: 20 }} />
            <Button
              label={selectedImage ? "Use this image" : "Select an image above"}
              onPress={onNext}
              disabled={!selectedImage}
              testID="images-continue"
            />
            <View style={{ height: 10 }} />
            <Button label="Regenerate" variant="secondary" onPress={retry} testID="images-regen" />
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
  loaderTitle: { fontSize: 18, fontWeight: "800", color: theme.colors.text900, marginTop: 16 },
  loaderStage: { fontSize: 14, color: theme.colors.primary, marginTop: 6, fontWeight: "600" },
  loaderNote: { fontSize: 12, color: theme.colors.text600, marginTop: 6 },
  errorBox: {
    backgroundColor: "#fff", borderRadius: 24, padding: 24, alignItems: "center", marginTop: 20, gap: 10,
    ...theme.shadow.card,
  },
  errorTitle: { fontSize: 17, fontWeight: "800", color: theme.colors.text900 },
  errorSub: { fontSize: 13, color: theme.colors.text600, textAlign: "center", marginBottom: 8 },
  imgCard: {
    backgroundColor: "#fff", borderRadius: 22, overflow: "hidden", marginBottom: 14,
    borderWidth: 3, borderColor: "transparent", ...theme.shadow.card,
  },
  imgCardSelected: { borderColor: theme.colors.primary },
  img: { width: "100%", height: 280, backgroundColor: theme.colors.border },
  imgFooter: { flexDirection: "row", alignItems: "center", padding: 14 },
  imgStyle: { fontSize: 15, fontWeight: "800", color: theme.colors.text900 },
  imgHint: { fontSize: 12, color: theme.colors.text600, marginTop: 2 },
  radio: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: theme.colors.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  radioSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
});
