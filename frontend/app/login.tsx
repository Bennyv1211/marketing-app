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

export default function Login() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    try {
      setLoading(true);
      await signIn(email.trim(), password);
      router.replace("/dashboard");
    } catch (e: any) {
      setErr(e?.message || "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={theme.colors.text800} />
          </TouchableOpacity>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to keep creating great posts.</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="login-email"
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
            testID="login-password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            placeholderTextColor={theme.colors.text400}
            secureTextEntry
            style={styles.input}
          />

          {err ? <Text style={styles.err} testID="login-error">{err}</Text> : null}

          <Button label="Sign in" onPress={onSubmit} loading={loading} testID="login-submit" />
          <View style={{ height: 12 }} />
          <Button
            label="Create a new account"
            variant="secondary"
            onPress={() => router.replace("/register")}
            testID="login-to-register"
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
    minHeight: 56, borderRadius: theme.radius.lg, borderWidth: 2, borderColor: theme.colors.border,
    backgroundColor: "#fff", paddingHorizontal: 16, fontSize: 16, color: theme.colors.text900,
  },
  err: { color: theme.colors.danger, marginTop: 10, fontSize: 14, fontWeight: "600" },
});
