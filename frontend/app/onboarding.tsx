import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Button from "../components/Button";
import { theme, BUSINESS_TYPES, TONES } from "../lib/theme";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

export default function Onboarding() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("Coffee shop");
  const [desc, setDesc] = useState("");
  const [tone, setTone] = useState<string>("friendly");
  const [postsAbout, setPostsAbout] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSave = async (skipOptional = false) => {
    setErr(null);
    if (!name.trim()) {
      setErr("Please tell us your business name.");
      return;
    }
    try {
      setLoading(true);
      await api.saveBusiness({
        business_name: name.trim(),
        business_type: type,
        description: skipOptional ? "" : desc.trim(),
        preferred_tone: tone,
        posts_about: skipOptional ? "" : postsAbout.trim(),
      });
      await refresh();
      router.replace("/dashboard");
    } catch (e: any) {
      setErr(e?.message || "Could not save. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Tell us about your business</Text>
          <Text style={styles.subtitle}>This helps us write better posts for you. You can change this later.</Text>

          <Text style={styles.label}>Business name</Text>
          <TextInput
            testID="ob-name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Maria's Bakery"
            placeholderTextColor={theme.colors.text400}
            style={styles.input}
          />

          <Text style={styles.label}>Business type</Text>
          <View style={styles.chips}>
            {BUSINESS_TYPES.map((t) => (
              <Chip key={t} label={t} selected={type === t} onPress={() => setType(t)} testID={`ob-type-${t}`} />
            ))}
          </View>

          <Text style={styles.label}>Short description (optional)</Text>
          <TextInput
            testID="ob-desc"
            value={desc}
            onChangeText={setDesc}
            placeholder="A cozy neighbourhood bakery in downtown."
            placeholderTextColor={theme.colors.text400}
            style={[styles.input, { height: 90, textAlignVertical: "top", paddingVertical: 12 }]}
            multiline
          />

          <Text style={styles.label}>Preferred tone</Text>
          <View style={styles.chips}>
            {TONES.map((t) => (
              <Chip
                key={t.key}
                label={t.label}
                selected={tone === t.key}
                onPress={() => setTone(t.key)}
                testID={`ob-tone-${t.key}`}
              />
            ))}
          </View>

          <Text style={styles.label}>What do you usually post about? (optional)</Text>
          <TextInput
            testID="ob-posts-about"
            value={postsAbout}
            onChangeText={setPostsAbout}
            placeholder="New pastries, weekend specials, seasonal drinks…"
            placeholderTextColor={theme.colors.text400}
            style={styles.input}
          />

          {err ? <Text style={styles.err} testID="ob-error">{err}</Text> : null}

          <View style={{ height: 20 }} />
          <Button label="Save and continue" onPress={() => onSave(false)} loading={loading} testID="ob-submit" />
          <View style={{ height: 10 }} />
          <Button label="Skip for now" variant="secondary" onPress={() => onSave(true)} testID="ob-skip" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Chip({ label, selected, onPress, testID }: any) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.chip, selected && styles.chipSelected]}
      testID={testID}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { padding: 24 },
  title: { fontSize: 28, fontWeight: "800", color: theme.colors.text900, marginBottom: 6 },
  subtitle: { fontSize: 15, color: theme.colors.text600, marginBottom: 18 },
  label: { fontSize: 14, fontWeight: "700", color: theme.colors.text800, marginTop: 16, marginBottom: 8 },
  input: {
    minHeight: 56, borderRadius: theme.radius.lg, borderWidth: 2, borderColor: theme.colors.border,
    backgroundColor: "#fff", paddingHorizontal: 16, fontSize: 16, color: theme.colors.text900,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    backgroundColor: "#fff", borderWidth: 2, borderColor: theme.colors.border,
  },
  chipSelected: { backgroundColor: theme.colors.primaryLight, borderColor: theme.colors.primary },
  chipText: { color: theme.colors.text800, fontWeight: "600" },
  chipTextSelected: { color: theme.colors.primary, fontWeight: "800" },
  err: { color: theme.colors.danger, marginTop: 12, fontSize: 14, fontWeight: "600" },
});
