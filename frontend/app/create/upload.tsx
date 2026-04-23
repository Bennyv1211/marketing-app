import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import Button from "../../components/Button";
import { StepHeader } from "../../components/StepHeader";
import { theme } from "../../lib/theme";
import { api } from "../../lib/api";
import { useWizard } from "../../lib/WizardContext";

export default function UploadStep() {
  const router = useRouter();
  const { upload, set } = useWizard();
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const pick = async (useCamera: boolean) => {
    setErr(null);
    try {
      let res: ImagePicker.ImagePickerResult;
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setErr("We need camera access to take a photo.");
          return;
        }
        res = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          base64: true,
          quality: 0.8,
          allowsEditing: false,
        });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setErr("We need access to your photos.");
          return;
        }
        res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          base64: true,
          quality: 0.8,
          allowsEditing: false,
        });
      }
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      let base64 = asset.base64;
      const mime = asset.mimeType || "image/jpeg";
      if (!base64 && asset.uri?.startsWith("data:")) {
        base64 = asset.uri.split(",")[1];
      }
      if (!base64) {
        setErr("Could not read that photo. Please try another.");
        return;
      }
      setUploading(true);
      const up: any = await api.uploadImage(base64, mime);
      set("upload", { id: up.id, data_uri: up.data_uri, mime_type: up.mime_type });
    } catch (e: any) {
      setErr(e?.message || "Something went wrong uploading your photo.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="back-btn">
          <Ionicons name="chevron-back" size={22} color={theme.colors.text800} />
        </TouchableOpacity>
        <StepHeader step={1} total={5} title="Add a photo" subtitle="Pick a product, food, or item photo. We'll turn it into an ad." />

        {upload ? (
          <View style={styles.previewWrap} testID="upload-preview">
            <Image source={{ uri: upload.data_uri }} style={styles.preview} />
            <TouchableOpacity style={styles.retake} onPress={() => set("upload", null)} testID="upload-retake">
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.retakeText}>Change photo</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.dropArea}>
            <View style={styles.dropIcon}>
              <Ionicons name="cloud-upload-outline" size={40} color={theme.colors.primary} />
            </View>
            <Text style={styles.dropTitle}>Upload a photo of your item</Text>
            <Text style={styles.dropSub}>JPG or PNG up to ~8 MB</Text>
          </View>
        )}

        {uploading ? (
          <View style={{ alignItems: "center", marginTop: 16 }}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={{ color: theme.colors.text600, marginTop: 8 }}>Uploading…</Text>
          </View>
        ) : null}

        {err ? <Text style={styles.err} testID="upload-error">{err}</Text> : null}

        {!upload ? (
          <>
            <View style={{ height: 20 }} />
            <Button label="Choose from gallery" onPress={() => pick(false)} testID="pick-gallery" />
            <View style={{ height: 10 }} />
            {Platform.OS !== "web" ? (
              <Button label="Take a photo" variant="secondary" onPress={() => pick(true)} testID="pick-camera" />
            ) : null}
          </>
        ) : (
          <>
            <View style={{ height: 24 }} />
            <Button label="Continue" onPress={() => router.push("/create/describe")} testID="upload-continue" />
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
  dropArea: {
    borderWidth: 2, borderColor: theme.colors.borderStrong, borderStyle: "dashed",
    borderRadius: 24, padding: 30, alignItems: "center", backgroundColor: "#fff",
  },
  dropIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.primaryLight,
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  dropTitle: { fontSize: 17, fontWeight: "700", color: theme.colors.text900 },
  dropSub: { fontSize: 13, color: theme.colors.text600, marginTop: 4 },
  previewWrap: { position: "relative", borderRadius: 24, overflow: "hidden" },
  preview: { width: "100%", height: 340, backgroundColor: theme.colors.border },
  retake: {
    position: "absolute", bottom: 12, right: 12, flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.65)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, gap: 6,
  },
  retakeText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  err: { color: theme.colors.danger, marginTop: 12, fontSize: 14, fontWeight: "600" },
});
