import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Button from "../../components/Button";
import { StepHeader } from "../../components/StepHeader";
import { theme, QUICK_SUGGESTIONS, POST_GOALS, TONES } from "../../lib/theme";
import { api } from "../../lib/api";
import { useWizard } from "../../lib/WizardContext";

export default function DescribeStep() {
  const router = useRouter();
  const { prompt, tone, postGoal, set, upload } = useWizard();
  const [text, setText] = useState(prompt);
  const [selectedTone, setSelectedTone] = useState(tone);
  const [selectedGoal, setSelectedGoal] = useState(postGoal);
  const [usage, setUsage] = useState<{ used_today: number; limit: number; remaining: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const u: any = await api.usageToday();
        setUsage(u);
      } catch {
        // non-blocking
      }
    })();
  }, []);

  const addSuggestion = (s: string) => {
    if (!text.trim()) {
      setText(`Make this look ${s.toLowerCase()}.`);
    } else {
      setText((t) => `${t.trim()} ${s}.`);
    }
  };

  const canContinue = text.trim().length >= 3 && !!upload;

  const onNext = () => {
    set("prompt", text.trim());
    set("tone", selectedTone);
    set("postGoal", selectedGoal);
    router.push("/create/images");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={theme.colors.text800} />
          </TouchableOpacity>
          <StepHeader step={2} total={5} title="Describe the post" subtitle="Tell us the vibe you want. Keep it simple." />

          <Text style={styles.label}>What kind of post do you want to make?</Text>
          <TextInput
            testID="describe-input"
            value={text}
            onChangeText={setText}
            multiline
            placeholder="Example: Make this look like a cozy coffee shop ad for a weekend special."
            placeholderTextColor={theme.colors.text400}
            style={styles.input}
          />

          <Text style={styles.subLabel}>Quick ideas — tap to add:</Text>
          <View style={styles.chips}>
            {QUICK_SUGGESTIONS.map((s) => (
              <TouchableOpacity
                key={s}
                style={styles.chip}
                onPress={() => addSuggestion(s)}
                testID={`suggest-${s}`}
              >
                <Text style={styles.chipText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Post goal</Text>
          <View style={styles.chips}>
            {POST_GOALS.map((g) => (
              <TouchableOpacity
                key={g.key}
                onPress={() => setSelectedGoal(g.key)}
                style={[styles.optionChip, selectedGoal === g.key && styles.optionSelected]}
                testID={`goal-${g.key}`}
              >
                <Text style={[styles.optionText, selectedGoal === g.key && styles.optionTextSelected]}>{g.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Tone</Text>
          <View style={styles.chips}>
            {TONES.slice(0, 4).map((t) => (
              <TouchableOpacity
                key={t.key}
                onPress={() => setSelectedTone(t.key)}
                style={[styles.optionChip, selectedTone === t.key && styles.optionSelected]}
                testID={`tone-${t.key}`}
              >
                <Text style={[styles.optionText, selectedTone === t.key && styles.optionTextSelected]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ height: 24 }} />
          {usage ? (
            <View
              style={[
                styles.usageBox,
                usage.remaining === 0 && { backgroundColor: "#FDEAE7" },
              ]}
              testID="usage-hint"
            >
              <Ionicons
                name={usage.remaining === 0 ? "alert-circle-outline" : "sparkles-outline"}
                size={16}
                color={usage.remaining === 0 ? theme.colors.danger : theme.colors.primary}
              />
              <Text style={styles.usageText}>
                {usage.remaining === 0
                  ? `Daily limit reached. You've used all ${usage.limit} ad image generations today. Please come back tomorrow.`
                  : `${usage.remaining} of ${usage.limit} ad image generations left today.`}
              </Text>
            </View>
          ) : null}
          <View style={{ height: 12 }} />
          <Button
            label={usage?.remaining === 0 ? "Daily limit reached" : "Generate ad images"}
            onPress={onNext}
            disabled={!canContinue}
            testID="describe-continue"
          />
        </ScrollView>
      </KeyboardAvoidingView>
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
  label: { fontSize: 15, fontWeight: "700", color: theme.colors.text800, marginTop: 20, marginBottom: 8 },
  subLabel: { fontSize: 13, color: theme.colors.text600, marginTop: 12, marginBottom: 8 },
  input: {
    minHeight: 110, borderRadius: theme.radius.lg, borderWidth: 2, borderColor: theme.colors.border,
    backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
    color: theme.colors.text900, textAlignVertical: "top",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    backgroundColor: theme.colors.primaryLight,
  },
  chipText: { color: theme.colors.primary, fontWeight: "700", fontSize: 13 },
  optionChip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    backgroundColor: "#fff", borderWidth: 2, borderColor: theme.colors.border,
  },
  optionSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryLight },
  optionText: { color: theme.colors.text800, fontWeight: "600" },
  optionTextSelected: { color: theme.colors.primary, fontWeight: "800" },
  usageBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 12, borderRadius: 14, backgroundColor: theme.colors.primaryLight,
  },
  usageText: { flex: 1, fontSize: 13, color: theme.colors.text800, fontWeight: "600", lineHeight: 18 },
});
