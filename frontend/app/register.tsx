import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Button from "../components/Button";
import { theme } from "../lib/theme";
import { useAuth } from "../lib/AuthContext";

export default function Register() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    if (!email.trim() || !password.trim()) {
      setErr("Please enter your email and a password.");
      return;
    }
    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    try {
      setLoading(true);
      await signUp(email.trim(), password, name.trim() || undefined);
      router.replace("/onboarding");
    } catch (e: any) {
      setErr(e?.message || "Could not create your account. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={theme.colors.text800} />
          </TouchableOpacity>
          <Text style={styles.title}>Let's get started</Text>
          <Text style={styles.subtitle}>Create a free account for your business.</Text>

          <Text style={styles.label}>Your name (optional)</Text>
          <TextInput
            testID="register-name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Maria"
            placeholderTextColor={theme.colors.text400}
            style={styles.input}
          />

          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="register-email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@business.com"
            placeholderTextColor={theme.colors.text400}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            testID="register-password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 6 characters"
            placeholderTextColor={theme.colors.text400}
            secureTextEntry
            style={styles.input}
          />

          {err ? <Text style={styles.err} testID="register-error">{err}</Text> : null}

          <Button
            label="Create account"
            onPress={onSubmit}
            loading={loading}
            testID="register-submit"
          />
          <View style={{ height: 12 }} />
          <Button
            label="I already have an account"
            variant="secondary"
            onPress={() => router.replace("/login")}
            testID="register-to-login"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { padding: 24, gap: 4 },
  back: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center", marginBottom: 16, ...theme.shadow.card,
  },
  title: { fontSize: 30, fontWeight: "800", color: theme.colors.text900, marginBottom: 6 },
  subtitle: { fontSize: 16, color: theme.colors.text600, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: "700", color: theme.colors.text800, marginTop: 12, marginBottom: 6 },
  input: {
    minHeight: 56,
    borderRadius: theme.radius.lg,
    borderWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    fontSize: 16,
    color: theme.colors.text900,
  },
  err: { color: theme.colors.danger, marginTop: 10, fontSize: 14, fontWeight: "600" },
});
